/**
 * Shared contract between the launcher (`e2e/start-test-server.ts`) and the
 * per-spec auth fixture (`e2e/fixtures/auth.ts`).
 *
 * The launcher pre-creates one throwaway user per key below and mints its
 * session in-process; each fixture-backed spec reads its own user by key. Adding
 * a spec that needs the fixture means adding its key here — the launcher then
 * seeds it automatically. `auth.spec.ts` (the login-form spec) intentionally
 * does NOT appear here: it drives the real UI login with the seeded admin.
 */
export const SPEC_USER_KEYS = [
  "onboarding",
  "inventory-crud",
  "delete-dialog",
  "theme",
  "magpul-mode",
  "magpul-settings",
  "label-prefix",
  "firearm-taxonomy",
  "firearm-nickname",
  "range-sessions",
  "range-sessions-share",
  "range-sessions-viewer",
] as const;

export type SpecUserKey = (typeof SPEC_USER_KEYS)[number];

/** Repo-relative path to the generated per-run env artifact (gitignored). */
export const ARTIFACT_PATH = "e2e/.artifacts/env.json";

export interface SeededUser {
  key: SpecUserKey;
  email: string;
  /**
   * Raw `better-auth.session_token` cookie value, loaded as storageState. The
   * per-user password is intentionally NOT persisted — nothing reads it, so it
   * stays out of the artifact's secret footprint.
   */
  sessionToken: string;
}

/** Shape of `e2e/.artifacts/env.json`, written by the launcher. */
export interface RunArtifact {
  baseURL: string;
  /** Seeded admin credentials — used by the login-form spec only. */
  admin: { email: string; password: string };
  users: SeededUser[];
}
