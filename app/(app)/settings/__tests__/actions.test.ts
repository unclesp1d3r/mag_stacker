import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Server-action unit test for `settings/actions.ts`'s maintenance-mode wiring
 * (KTD5 write-path enforcement gap fix). Mocks the session, the maintenance
 * guard, and the DB update chain (`mock.module`, mirroring
 * `app/(app)/firearms/__tests__/documents-actions.test.ts`'s approach) rather
 * than hitting a real DB — this only needs to prove `updateMagpulModeAction`
 * calls `assertWritesAllowed` before writing and propagates a
 * `MaintenanceModeError` as a failed, non-throwing `ActionResult`, and that a
 * successful check still reaches the update.
 */

let currentUserId: string | null = "user-1";
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () => (currentUserId ? { id: currentUserId } : null),
}));

let assertWritesAllowedThrows: unknown = null;
let assertWritesAllowedCalls = 0;
class FakeMaintenanceModeError extends Error {
  constructor() {
    super(
      "instance is under maintenance (restore in progress); try again shortly",
    );
    this.name = "MaintenanceModeError";
  }
}
mock.module("@/src/backup/maintenance", () => ({
  assertWritesAllowed: async () => {
    assertWritesAllowedCalls += 1;
    if (assertWritesAllowedThrows) throw assertWritesAllowedThrows;
  },
  MaintenanceModeError: FakeMaintenanceModeError,
}));

let updateCalls = 0;
let updateResult: { id: string }[] = [{ id: "user-1" }];
mock.module("@/src/db/client", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            updateCalls += 1;
            return updateResult;
          },
        }),
      }),
    }),
  },
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const { updateMagpulModeAction } = await import("../actions");

beforeEach(() => {
  currentUserId = "user-1";
  assertWritesAllowedThrows = null;
  assertWritesAllowedCalls = 0;
  updateCalls = 0;
  updateResult = [{ id: "user-1" }];
});

describe("updateMagpulModeAction", () => {
  test("checks maintenance before writing and succeeds when writes are allowed", async () => {
    const result = await updateMagpulModeAction(true);

    expect(assertWritesAllowedCalls).toBe(1);
    expect(updateCalls).toBe(1);
    expect(result.ok).toBe(true);
  });

  test("does not write and returns a failed, non-throwing ActionResult while maintenance is active", async () => {
    assertWritesAllowedThrows = new FakeMaintenanceModeError();

    const result = await updateMagpulModeAction(true);

    expect(assertWritesAllowedCalls).toBe(1);
    expect(updateCalls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/maintenance/i);
  });
});
