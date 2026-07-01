/**
 * Playwright `webServer.command` launcher (issue #6, KTD1–KTD4).
 *
 * Owns the full test backend lifecycle in one process, in this order:
 *   1. Generate a random BETTER_AUTH_SECRET + admin credentials (nothing
 *      hardcoded) and export them BEFORE importing anything that loads `@/auth`.
 *   2. Start an ephemeral Postgres via the idiomatic Testcontainers module; take
 *      its connection URI as DATABASE_URL. The Ryuk reaper removes the container
 *      when this process exits (crash, kill, or normal exit).
 *   3. Migrate + seed the admin as subprocesses (both self-exec + process.exit,
 *      so they can't be imported).
 *   4. Pre-seed the per-spec user pool: create each user and mint its session
 *      IN-PROCESS via `auth.handler` — rotating `x-forwarded-for` per call so the
 *      DB-stored `/sign-in/email` rate limit (5/60s) never trips regardless of
 *      pool size. Write the resolved env (incl. session tokens) to the artifact.
 *   5. Ensure a production build, then SPAWN (not exec) `next start` so the
 *      SIGINT/SIGTERM trap that stops the container survives; the trap also
 *      forwards the kill to the Next child so it is never orphaned.
 *
 * Playwright starts `webServer` BEFORE `globalSetup`, which is exactly why the
 * container cannot live in `globalSetup` — the app must not boot before the DB
 * and the seeded users exist.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  ARTIFACT_PATH,
  type RunArtifact,
  type SeededUser,
  SPEC_USER_KEYS,
} from "./fixtures/user-pool";

const PORT = 3210;
const BASE_URL = `http://localhost:${PORT}`;
const POSTGRES_IMAGE = "postgres:17";

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** Rotate the client IP per sign-in so the DB rate-limit bucket never trips. */
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}

/** Extract the raw `better-auth.session_token` cookie value from a Set-Cookie. */
function extractSessionToken(setCookie: string): string {
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
  if (!match) {
    throw new Error(
      `Sign-in did not return a better-auth.session_token cookie. Set-Cookie: ${setCookie}`,
    );
  }
  return match[1];
}

/** Run a repo script (migrate/seed/build) as a subprocess under the same bun. */
function runScript(args: string[], label: string): void {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? "signal"}).`);
  }
}

async function main(): Promise<void> {
  // 1. Secrets first — seed-admin.ts and the in-process auth import need these
  //    at module load, so they must be set before any `@/auth` import.
  const adminEmail = "admin@e2e.local";
  const adminPassword = randomHex(16);
  process.env.BETTER_AUTH_SECRET = randomHex(32);
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.ADMIN_EMAIL = adminEmail;
  process.env.ADMIN_PASSWORD = adminPassword;

  // 2. Ephemeral Postgres (built-in wait strategy; Ryuk reaps on exit).
  console.log(`[e2e] starting ${POSTGRES_IMAGE} container…`);
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("magstacker_test")
    .start();
  process.env.DATABASE_URL = container.getConnectionUri();
  console.log("[e2e] container up; DATABASE_URL set.");

  let child: ChildProcess | undefined;
  let shuttingDown = false;

  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
    }
    try {
      await container.stop();
    } catch (error) {
      console.error("[e2e] container.stop() failed:", error);
    }
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  try {
    // 3. Schema + admin.
    console.log("[e2e] applying migrations…");
    runScript(["src/db/migrate.ts"], "Migration");
    console.log("[e2e] seeding admin…");
    runScript(["scripts/seed-admin.ts"], "Admin seed");

    // 4. Per-spec user pool + in-process session minting.
    console.log(`[e2e] pre-seeding ${SPEC_USER_KEYS.length} spec users…`);
    const { auth } = await import("@/auth");
    const users: SeededUser[] = [];
    for (const key of SPEC_USER_KEYS) {
      const email = `${key}@e2e.local`;
      const password = randomHex(12);
      await auth.api.createUser({
        body: { email, password, name: key, role: "user" },
      });
      const signIn = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": freshIp(),
          },
          body: JSON.stringify({ email, password }),
        }),
      );
      if (signIn.status !== 200) {
        throw new Error(
          `Sign-in for ${email} returned ${signIn.status}; expected 200.`,
        );
      }
      const sessionToken = extractSessionToken(
        signIn.headers.get("set-cookie") ?? "",
      );
      users.push({ key, email, password, sessionToken });
    }

    const artifact: RunArtifact = {
      baseURL: BASE_URL,
      admin: { email: adminEmail, password: adminPassword },
      users,
    };
    mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
    writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
    console.log(`[e2e] wrote ${ARTIFACT_PATH}.`);

    // 5. Ensure a production build, then serve it as a supervised child.
    if (!existsSync(".next/BUILD_ID")) {
      console.log("[e2e] no production build found; running next build…");
      runScript(["run", "build"], "Build");
    }
    console.log(`[e2e] starting next start on :${PORT}…`);
    child = spawn(
      process.execPath,
      ["run", "start", "--", "-p", String(PORT)],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (exitCode) => {
      if (!shuttingDown) {
        console.error(`[e2e] next start exited early (${exitCode}).`);
        void shutdown(exitCode ?? 1);
      }
    });
  } catch (error) {
    console.error("[e2e] launcher failed during setup:", error);
    await shutdown(1);
  }
}

void main();
