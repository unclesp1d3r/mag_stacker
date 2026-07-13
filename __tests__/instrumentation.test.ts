import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

/**
 * Focused unit tests for `register()` — `instrumentation.ts`'s Next.js
 * server-startup hook. Covers the three real branches called out in that
 * file's own doc comment:
 *   1. `NEXT_RUNTIME !== "nodejs"` — early return, the recovery sweep never runs.
 *   2. `DATABASE_URL` unset — early return, the recovery sweep never runs.
 *   3. The try/catch around `recoverInterruptedRestore` — a recovery failure
 *      must be caught and logged, never rethrown (a boot-recovery failure
 *      must not crash the server).
 *
 * **Deliberately lives OUTSIDE `src/`** (not `src/__tests__/`) and is run as
 * its own invocation (`bun test __tests__/instrumentation.test.ts`), never
 * bundled into `bun run test`'s `bun test src` / `just ci-check`. Verified
 * empirically against this repo's actual Bun version (1.3.14): `mock.module()`
 * replaces a module specifier for the rest of the **process**, not just this
 * file, and — critically — if any OTHER file anywhere in the same `bun test`
 * invocation has a static `import` of that same module, the real module gets
 * linked into the cache before this file's `mock.module()` call ever runs
 * (regardless of file ordering), which either silently no-ops the mock here
 * or (if this file's mock registers first) corrupts the real module for
 * every other file that statically imports it — reproduced directly: a
 * `mock.module("@/src/backup/maintenance", () => ({ POISONED: true }))` in a
 * file that sorts before `src/backup/__tests__/maintenance.test.ts` made that
 * file fail at load time with `SyntaxError: Export named 'isMaintenanceActive'
 * not found`. `src/backup/__tests__/maintenance.test.ts` and
 * `src/backup/__tests__/write-path-maintenance-guard.test.ts` both statically
 * import the REAL `@/src/backup/maintenance`/`@/src/db/client`, so mocking
 * those specifiers here would be unsafe inside `bun test src`. This file's
 * own `afterAll` "restore" (re-registering `mock.module` with the real
 * exports) does NOT fix this either — restoring a `mock.module()` override
 * does not retroactively repair an already-linked static import in another
 * file, the same constraint `src/backup/__tests__/routes.test.ts` documents
 * for `@/src/db/client`. Living outside `src/` sidesteps the whole class of
 * problem: this file never shares a `bun test` process with those tests.
 */

const ORIGINAL_NEXT_RUNTIME = process.env.NEXT_RUNTIME;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

let recoverCalls = 0;
let recoverShouldThrow: unknown = null;

mock.module("@/src/db/client", () => ({
  db: { fake: "db-handle" },
}));
mock.module("@/src/storage", () => ({
  activeStorageRoot: () => "/fake/storage/root",
}));
mock.module("@/src/backup/maintenance", () => ({
  recoverInterruptedRestore: async () => {
    recoverCalls += 1;
    if (recoverShouldThrow) throw recoverShouldThrow;
  },
}));

// instrumentation.ts has no top-level imports of its own — every dependency
// is dynamically imported inside `register()` at call time (see its doc
// comment) — so it's safe to statically import `register` here regardless
// of ordering relative to the `mock.module()` calls above.
const { register } = await import("../instrumentation");

function restoreEnv(): void {
  if (ORIGINAL_NEXT_RUNTIME === undefined) {
    delete process.env.NEXT_RUNTIME;
  } else {
    process.env.NEXT_RUNTIME = ORIGINAL_NEXT_RUNTIME;
  }
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
}

describe("instrumentation.register()", () => {
  beforeEach(() => {
    recoverCalls = 0;
    recoverShouldThrow = null;
  });

  afterEach(() => {
    restoreEnv();
  });

  afterAll(() => {
    restoreEnv();
  });

  test('resolves without running the recovery sweep when NEXT_RUNTIME is not "nodejs"', async () => {
    delete process.env.NEXT_RUNTIME;
    process.env.DATABASE_URL = "postgres://ignored/ignored";

    await expect(register()).resolves.toBeUndefined();
    expect(recoverCalls).toBe(0);
  });

  test("resolves without running the recovery sweep when DATABASE_URL is unset", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.DATABASE_URL;

    await expect(register()).resolves.toBeUndefined();
    expect(recoverCalls).toBe(0);
  });

  test("runs the recovery sweep exactly once when both NEXT_RUNTIME and DATABASE_URL are set", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.DATABASE_URL = "postgres://ignored/ignored";

    await expect(register()).resolves.toBeUndefined();
    expect(recoverCalls).toBe(1);
  });

  test("swallows a recoverInterruptedRestore failure — register() never rethrows (a boot-recovery failure must not crash the server)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.DATABASE_URL = "postgres://ignored/ignored";
    recoverShouldThrow = new Error("simulated recovery failure");

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(register()).resolves.toBeUndefined();
      expect(recoverCalls).toBe(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain(
        "crash-recovery sweep failed",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
