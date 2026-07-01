/**
 * Per-spec auth fixture (issue #6, R2/R3, KTD3).
 *
 * The launcher pre-seeded one throwaway user per key and minted its session
 * in-process, writing the raw `better-auth.session_token` value into the run
 * artifact. This fixture loads that token as Playwright `storageState` — no HTTP
 * sign-in, no UI login on this path. A distinct per-spec user gives owner-scoped
 * isolation (R2); the launcher's `BETTER_AUTH_URL` equals the Playwright
 * `baseURL`, so the session passes Better Auth's origin check (R3).
 *
 * Usage in a spec:
 *   import { authTest as test, expect } from "./fixtures/auth";
 *   const test = authTest("onboarding");
 */
import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { ARTIFACT_PATH, type RunArtifact, type SpecUserKey } from "./user-pool";

/** Read the launcher's resolved-env artifact (baseURL, admin creds, users). */
export function readArtifact(): RunArtifact {
  try {
    return JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as RunArtifact;
  } catch (error) {
    throw new Error(
      `Could not read the e2e run artifact at ${ARTIFACT_PATH}. The launcher ` +
        `(e2e/start-test-server.ts) writes it before the app boots. Cause: ${String(error)}`,
    );
  }
}

/** Build a Playwright storageState carrying this user's session cookie. */
function storageStateFor(userKey: SpecUserKey) {
  const artifact = readArtifact();
  const user = artifact.users.find((candidate) => candidate.key === userKey);
  if (!user) {
    throw new Error(
      `No pre-seeded user for key "${userKey}". Add it to SPEC_USER_KEYS in e2e/fixtures/user-pool.ts.`,
    );
  }
  const { hostname } = new URL(artifact.baseURL);
  return {
    cookies: [
      {
        name: "better-auth.session_token",
        value: user.sessionToken,
        domain: hostname,
        path: "/",
        // Session cookie: no expiry. Reproduce Better Auth's attributes exactly
        // (httpOnly, Lax, insecure on http://localhost) or the browser drops it.
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
}

/**
 * Returns a `test` bound to the given pre-seeded user. Each spec calls this once
 * at module scope with its own key so its pages start authenticated.
 */
export function authTest(userKey: SpecUserKey) {
  return base.extend({
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures require the fixtures arg; this one depends on none.
    storageState: async ({}, use) => {
      await use(storageStateFor(userKey));
    },
  });
}

export { expect };
