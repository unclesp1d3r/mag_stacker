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
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  ARTIFACT_PATH,
  type RunArtifact,
  type SeededUser,
  SPEC_USER_KEYS,
} from "./fixtures/user-pool";

// playwright.config.ts reserves a free port and passes it here via
// webServer.env. The launcher is only ever run as that webServer command.
const PORT = Number(process.env.E2E_PORT);
if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error(
    "E2E_PORT must be set by playwright.config.ts (webServer.env). Run the suite via `bun run test:e2e`.",
  );
}
const BASE_URL = `http://localhost:${PORT}`;
// AWS ECR Public mirror of the Docker Official postgres image. It is not
// subject to Docker Hub's unauthenticated per-IP pull limit, which otherwise
// 429s on shared CI runner IPs. Digest-pinned for an immutable test runtime;
// the `:17` tag is kept for readability. To bump: pull the tag, then
// `docker inspect --format='{{index .RepoDigests 0}}'` for the new digest and
// update this constant AND the CI pre-pull step in .github/workflows/ci.yml.
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";
const E2E_DB_NAME = "magstacker_test";

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * A client-IP rotator: each call returns a fresh RFC 5737 test-net IP so the
 * DB-stored `/sign-in/email` rate-limit bucket (keyed on x-forwarded-for) never
 * trips while the pool mints its N sessions. State is closure-local, not module
 * scope.
 */
function makeIpRotator(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `198.51.100.${(n % 250) + 1}`;
  };
}
const freshIp = makeIpRotator();

/**
 * Read all Set-Cookie values, spec-safely. Per WHATWG Fetch, `headers.get` must
 * not combine multiple Set-Cookie headers — `getSetCookie()` (an array) is the
 * correct API. Fall back to `get` for runtimes without it.
 */
function readSetCookie(headers: Headers): string {
  const withGetSetCookie = headers as Headers & { getSetCookie?(): string[] };
  return (
    withGetSetCookie.getSetCookie?.().join(", ") ??
    headers.get("set-cookie") ??
    ""
  );
}

/** Extract the raw `better-auth.session_token` cookie value from a Set-Cookie. */
function extractSessionToken(setCookie: string): string {
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
  if (!match) {
    // Report only the cookie names present — never the raw header, which would
    // leak session tokens into CI logs/artifacts.
    const names =
      setCookie
        .split(/,(?=[^;]+=)/)
        .map((c) => c.trim().split("=")[0])
        .filter(Boolean)
        .join(", ") || "(none)";
    throw new Error(
      `Sign-in did not return a better-auth.session_token cookie. Cookies present: ${names}`,
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

  // 2. Ephemeral Postgres (built-in wait strategy; Ryuk reaps on exit). Fail
  //    fast with a clear message if it can't start — otherwise the error escapes
  //    main() as an unhandled rejection and Playwright only reports a generic
  //    5-minute webServer timeout. No container exists yet, so nothing to stop.
  console.log(`[e2e] starting ${POSTGRES_IMAGE} container…`);
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase(E2E_DB_NAME)
      .start();
  } catch (error) {
    console.error(
      "[e2e] container failed to start (is Docker running?):",
      error,
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = container.getConnectionUri();
  console.log("[e2e] container up; DATABASE_URL set.");

  let child: ChildProcess | undefined;
  let shuttingDown = false;

  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      // Let the Next child drain before cutting the DB connection, so teardown
      // doesn't leave "terminating connection" noise in the container log.
      // Bounded so a stuck child can't hang teardown.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        child?.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
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
    // Import Drizzle helpers for post-creation attribute updates. These must be
    // loaded after DATABASE_URL is set (above), which is why they're dynamic.
    const { db } = await import("@/src/db/client");
    const { eq } = await import("drizzle-orm");
    const { user: userTable } = await import("@/src/db/schema");
    const users: SeededUser[] = [];
    for (const key of SPEC_USER_KEYS) {
      const email = `${key}@e2e.local`;
      const password = randomHex(12);
      await auth.api.createUser({
        body: { email, password, name: key, role: "user" },
      });
      // "magpul-mode" needs Magpul mode pre-enabled. We set it with a follow-up
      // Drizzle write (parity with the settings-toggle path) rather than via
      // createUser's `data` passthrough, and assert a row was actually updated
      // so a mismatched email fails loudly here instead of as a confusing
      // downstream spec failure.
      if (key === "magpul-mode") {
        const updated = await db
          .update(userTable)
          .set({ magpulMode: true })
          .where(eq(userTable.email, email))
          .returning({ id: userTable.id });
        if (updated.length === 0) {
          throw new Error(`Failed to enable magpulMode for ${email}`);
        }
      }
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
      const sessionToken = extractSessionToken(readSetCookie(signIn.headers));
      users.push({ key, email, sessionToken });
    }

    const artifact: RunArtifact = {
      baseURL: BASE_URL,
      admin: { email: adminEmail, password: adminPassword },
      users,
    };
    // Restrictive modes: the artifact holds generated admin creds + session
    // tokens, so keep it owner-only (0700 dir / 0600 file), not world-readable.
    mkdirSync(dirname(ARTIFACT_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2), {
      mode: 0o600,
    });
    console.log(`[e2e] wrote ${ARTIFACT_PATH}.`);

    // 5. Ensure a fresh production build, then serve it as a supervised child.
    //    Locally, always rebuild — `.next/BUILD_ID` only proves *some* build
    //    exists, so after app edits it would serve a stale bundle. In CI the
    //    workflow already ran an explicit build step, so skip the double build.
    if (!process.env.CI) {
      console.log("[e2e] building the app…");
      runScript(["run", "build"], "Build");
    } else if (!existsSync(".next/BUILD_ID")) {
      console.log("[e2e] no production build found; running next build…");
      runScript(["run", "build"], "Build");
    }
    console.log(`[e2e] starting next start on :${PORT}…`);
    child = spawn(
      process.execPath,
      // Start via the shim so this run's DB/auth env wins over any local `.env`
      // (or mise env_cache) that bun/Next would otherwise re-load in the app.
      [
        "e2e/start-app.ts",
        process.env.DATABASE_URL ?? "",
        process.env.BETTER_AUTH_URL ?? "",
        process.env.BETTER_AUTH_SECRET ?? "",
        "-p",
        String(PORT),
      ],
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

main().catch((error) => {
  console.error("[e2e] launcher crashed:", error);
  process.exit(1);
});
