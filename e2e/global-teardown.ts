/**
 * Thin teardown safety net (KTD1).
 *
 * The launcher (`e2e/start-test-server.ts`) owns the container and stops it on
 * SIGTERM, and the Testcontainers Ryuk reaper removes it when the launcher
 * process exits regardless. So there is no cross-process container handle to
 * clean up here. This hook only clears the resolved-env artifact, which holds
 * generated credentials and session tokens, so it never lingers on disk after a
 * run.
 */
import { rmSync } from "node:fs";
import { ARTIFACT_PATH } from "./fixtures/user-pool";

export default function globalTeardown(): void {
  rmSync(ARTIFACT_PATH, { force: true });
}
