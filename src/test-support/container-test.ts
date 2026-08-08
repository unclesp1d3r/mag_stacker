import { test as bunTest } from "bun:test";

/**
 * `test` with a timeout that matches what a Testcontainers-backed suite
 * actually costs.
 *
 * Bun's default is 5 seconds. The suites that start their own Postgres run key
 * derivation, tar packing, full-database wipes, migration replays, and (in the
 * restore suite) advisory-lock serialization of two concurrent restores — work
 * that legitimately takes 5–8 seconds and more on a loaded machine. At the
 * default, that is a load tripwire rather than a signal about the code.
 *
 * Tripping it is not a contained failure, which is what makes it worth a shared
 * helper instead of a per-test number. Bun marks the test failed but the
 * timed-out body keeps running, so the suite's `afterAll` ends the pool
 * underneath it and every remaining test in that file cascades into "Cannot use
 * a pool after calling end on the pool" — failures that name the wrong test and
 * point at nothing real. `just ci-check` then fails in a different, larger
 * subset on each run while each file passes in isolation, which reads as
 * "flaky infrastructure" and gets waved off instead of fixed.
 *
 * 60s is ~7x the slowest observed run, so a genuine hang still fails, just
 * later. Deliberately NOT the suite-wide default: the ~1250 tests that never
 * touch a container have no business taking seconds, and should keep a tight
 * tripwire.
 *
 * Import it aliased — `import { containerTest as test } from "..."` — so call
 * sites stay `test("...", ...)`. A longer identifier reflows the formatter's
 * wrapping through every test body, turning a one-line change into a
 * several-hundred-line diff nobody can review.
 */
export const CONTAINER_TEST_TIMEOUT_MS = 60_000;

export function containerTest(
  name: string,
  body: () => void | Promise<unknown>,
): void {
  bunTest(name, body, CONTAINER_TEST_TIMEOUT_MS);
}
