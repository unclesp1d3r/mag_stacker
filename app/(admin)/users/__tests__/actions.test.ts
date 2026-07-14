import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Server-action unit test for `users/actions.ts`'s maintenance-mode wiring
 * (KTD5 write-path enforcement gap fix). These admin operations go through
 * Better Auth's admin API (`auth.api.createUser`/`banUser`/`unbanUser`), not
 * the shared `authorize.ts` gates, so they needed their own explicit
 * `assertWritesAllowed` call — this proves it's actually wired in and blocks
 * before the Better Auth call runs. Mocks the session, Better Auth, headers,
 * and the maintenance guard (`mock.module`, mirroring
 * `app/(app)/firearms/__tests__/documents-actions.test.ts`'s approach) rather
 * than exercising real Better Auth/DB.
 */

let currentRole: string | null = "admin";
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () =>
    currentRole ? { id: "admin-1", role: currentRole } : null,
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

let createUserCalls = 0;
let banUserCalls = 0;
let unbanUserCalls = 0;
mock.module("@/auth", () => ({
  auth: {
    api: {
      createUser: async () => {
        createUserCalls += 1;
        return {};
      },
      banUser: async () => {
        banUserCalls += 1;
        return {};
      },
      unbanUser: async () => {
        unbanUserCalls += 1;
        return {};
      },
    },
  },
}));

mock.module("next/headers", () => ({
  headers: async () => new Headers(),
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const { createAccountAction, setAccountDisabledAction } = await import(
  "../actions"
);

beforeEach(() => {
  currentRole = "admin";
  assertWritesAllowedThrows = null;
  assertWritesAllowedCalls = 0;
  createUserCalls = 0;
  banUserCalls = 0;
  unbanUserCalls = 0;
});

function accountFormData(): FormData {
  const formData = new FormData();
  formData.set("email", "new-user@example.test");
  formData.set("name", "New User");
  formData.set("password", "password123");
  return formData;
}

describe("createAccountAction", () => {
  test("checks maintenance before calling Better Auth and succeeds when writes are allowed", async () => {
    const result = await createAccountAction(accountFormData());

    expect(assertWritesAllowedCalls).toBe(1);
    expect(createUserCalls).toBe(1);
    expect(result.ok).toBe(true);
  });

  test("does not call Better Auth and returns a failed, non-throwing ActionResult while maintenance is active", async () => {
    assertWritesAllowedThrows = new FakeMaintenanceModeError();

    const result = await createAccountAction(accountFormData());

    expect(assertWritesAllowedCalls).toBe(1);
    expect(createUserCalls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/maintenance/i);
  });
});

describe("setAccountDisabledAction", () => {
  test("checks maintenance before calling Better Auth and succeeds when writes are allowed", async () => {
    const result = await setAccountDisabledAction("user-2", true);

    expect(assertWritesAllowedCalls).toBe(1);
    expect(banUserCalls).toBe(1);
    expect(result.ok).toBe(true);
  });

  test("does not call Better Auth and returns a failed, non-throwing ActionResult while maintenance is active", async () => {
    assertWritesAllowedThrows = new FakeMaintenanceModeError();

    const result = await setAccountDisabledAction("user-2", false);

    expect(assertWritesAllowedCalls).toBe(1);
    expect(banUserCalls).toBe(0);
    expect(unbanUserCalls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/maintenance/i);
  });
});
