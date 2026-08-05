import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { ValidationError } from "@/src/domain/errors";
import type {
  ServiceRuleDefaultInput,
  ServiceRuleDefaultRow,
  ServiceRuleDefaultUpdateInput,
} from "@/src/domain/service-intervals/rules-service";
import * as rulesService from "@/src/domain/service-intervals/rules-service";

/**
 * Server-action unit tests for the service-defaults settings surface (U7).
 * Mocks the session (`mock.module`, mirroring
 * `app/(app)/firearms/__tests__/documents-actions.test.ts`) rather than
 * hitting the DB — this only exercises the `"use server"` action boundary:
 * auth gating and `ActionResult` mapping. Rules-service behavior itself
 * (validation, owner-scoping, duplicate names) is covered by
 * `src/domain/service-intervals/__tests__/rules-service.test.ts`.
 *
 * The three default-CRUD functions are `spyOn`-stubbed on the REAL
 * `rules-service` module namespace rather than `mock.module`-replaced: a
 * `mock.module` factory here can only export the handful of functions this
 * file cares about, and that narrow shape then "wins" for every other file's
 * import of the same specifier for the rest of the `bun test` process
 * (confirmed by direct repro, mirrors the tradeoff documented in
 * `firearms/__tests__/service-actions.test.ts`) — including
 * `accessories/[id]/__tests__/service-props.test.ts`, whose imported
 * `due-service.ts` statically imports OTHER rules-service exports
 * (`loadItemRules`, `requireAccessoryOwner`) that a narrow mock omits
 * entirely, breaking that file's import at load time. `spyOn` overrides only
 * the three named exports this file needs, leaving the rest of the module's
 * real surface intact for everyone else.
 */

let currentUserId: string | null = null;
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () => (currentUserId ? { id: currentUserId } : null),
}));

interface CreateCall {
  actorId: string;
  input: ServiceRuleDefaultInput;
}
let createCalls: CreateCall[] = [];
let createResult: ServiceRuleDefaultRow = {
  id: "default-1",
} as ServiceRuleDefaultRow;
let createThrows: unknown = null;

interface UpdateCall {
  actorId: string;
  id: string;
  input: ServiceRuleDefaultUpdateInput;
}
let updateCalls: UpdateCall[] = [];
let updateResult: ServiceRuleDefaultRow = {
  id: "default-1",
} as ServiceRuleDefaultRow;
let updateThrows: unknown = null;

interface DeleteCall {
  actorId: string;
  id: string;
}
let deleteCalls: DeleteCall[] = [];
let deleteThrows: unknown = null;

// Server actions revalidate on every mutation; a bare bun test has no Next.js
// request/render context for this to hook into (mirrors documents-actions.test.ts).
let revalidateCalls: string[] = [];
mock.module("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidateCalls.push(path);
  },
}));

const {
  createServiceRuleDefaultAction,
  deleteServiceRuleDefaultAction,
  updateServiceRuleDefaultAction,
} = await import("../actions");

beforeEach(() => {
  currentUserId = null;
  createCalls = [];
  createResult = { id: "default-1" } as ServiceRuleDefaultRow;
  createThrows = null;
  updateCalls = [];
  updateResult = { id: "default-1" } as ServiceRuleDefaultRow;
  updateThrows = null;
  deleteCalls = [];
  deleteThrows = null;
  revalidateCalls = [];

  spyOn(rulesService, "createServiceRuleDefault").mockImplementation(
    async (actorId: string, input: ServiceRuleDefaultInput) => {
      createCalls.push({ actorId, input });
      if (createThrows) throw createThrows;
      return createResult;
    },
  );
  spyOn(rulesService, "updateServiceRuleDefault").mockImplementation(
    async (
      actorId: string,
      id: string,
      input: ServiceRuleDefaultUpdateInput,
    ) => {
      updateCalls.push({ actorId, id, input });
      if (updateThrows) throw updateThrows;
      return updateResult;
    },
  );
  spyOn(rulesService, "deleteServiceRuleDefault").mockImplementation(
    async (actorId: string, id: string) => {
      deleteCalls.push({ actorId, id });
      if (deleteThrows) throw deleteThrows;
    },
  );
});

const SAMPLE_INPUT: ServiceRuleDefaultInput = {
  scope: "firearm",
  category: "rifle",
  name: "Cleaning",
  intervalRounds: 500,
};

describe("createServiceRuleDefaultAction", () => {
  test("covers: a signed-out request to the settings action is rejected", async () => {
    currentUserId = null;

    const result = await createServiceRuleDefaultAction(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(createCalls).toHaveLength(0);
  });

  test("forwards the resolved actor id and input to the service, and revalidates on success", async () => {
    currentUserId = "user-1";

    const result = await createServiceRuleDefaultAction(SAMPLE_INPUT);

    expect(result.ok).toBe(true);
    expect(createCalls).toEqual([{ actorId: "user-1", input: SAMPLE_INPUT }]);
    expect(revalidateCalls).toContain("/settings/service");
  });

  test("maps a ValidationError (empty name, no threshold, duplicate name) to a failed ActionResult with codes, and does not revalidate", async () => {
    currentUserId = "user-1";
    createThrows = new ValidationError(["duplicateName"]);

    const result = await createServiceRuleDefaultAction(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.codes).toEqual(["duplicateName"]);
    expect(revalidateCalls).toHaveLength(0);
  });

  // A malformed payload (`null` here — same as any non-object a client could
  // send in place of the real shape) must produce the normal failed
  // ActionResult, not an unhandled TypeError from reading `.scope` off it.
  test("a malformed non-object payload is rejected as a failed ActionResult, without reaching the service", async () => {
    currentUserId = "user-1";

    const result = await createServiceRuleDefaultAction(
      null as unknown as ServiceRuleDefaultInput,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.codes).toEqual(["invalidPayload"]);
    expect(createCalls).toHaveLength(0);
  });
});

describe("updateServiceRuleDefaultAction", () => {
  test("rejects an unauthenticated caller without touching the service", async () => {
    currentUserId = null;

    const result = await updateServiceRuleDefaultAction("default-1", {
      name: "Cleaning",
      intervalRounds: 600,
    });

    expect(result.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  test("forwards the resolved actor id, default id, and input to the service", async () => {
    currentUserId = "user-1";
    const input: ServiceRuleDefaultUpdateInput = {
      name: "Cleaning",
      intervalRounds: 600,
    };

    const result = await updateServiceRuleDefaultAction("default-1", input);

    expect(result.ok).toBe(true);
    expect(updateCalls).toEqual([
      { actorId: "user-1", id: "default-1", input },
    ]);
    expect(revalidateCalls).toContain("/settings/service");
  });

  test("maps a NotFoundError (another owner's default) to a non-leaking failed ActionResult", async () => {
    currentUserId = "user-1";
    updateThrows = new NotFoundError();

    const result = await updateServiceRuleDefaultAction("default-1", {
      name: "Cleaning",
      intervalRounds: 600,
    });

    expect(result.ok).toBe(false);
  });

  test("maps a NotAuthorizedError to a non-leaking failed ActionResult", async () => {
    currentUserId = "user-1";
    updateThrows = new NotAuthorizedError();

    const result = await updateServiceRuleDefaultAction("default-1", {
      name: "Cleaning",
      intervalRounds: 600,
    });

    expect(result.ok).toBe(false);
  });

  // Consistency gap this suite guards against: only the create action had
  // this guard previously — update read `input.name.trim()` unguarded, which
  // throws a raw TypeError on a malformed (`null`) payload instead of the
  // normal failed ActionResult every other malformed submission takes.
  test("a malformed non-object payload is rejected as a failed ActionResult, without reaching the service", async () => {
    currentUserId = "user-1";

    const result = await updateServiceRuleDefaultAction(
      "default-1",
      null as unknown as ServiceRuleDefaultUpdateInput,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.codes).toEqual(["invalidPayload"]);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("deleteServiceRuleDefaultAction", () => {
  test("rejects an unauthenticated caller without touching the service", async () => {
    currentUserId = null;

    const result = await deleteServiceRuleDefaultAction("default-1");

    expect(result.ok).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });

  test("calls deleteServiceRuleDefault with the resolved actor and given id, and revalidates", async () => {
    currentUserId = "user-1";

    const result = await deleteServiceRuleDefaultAction("default-1");

    expect(result.ok).toBe(true);
    expect(deleteCalls).toEqual([{ actorId: "user-1", id: "default-1" }]);
    expect(revalidateCalls).toContain("/settings/service");
  });

  test("maps a NotFoundError (another owner's default) to a non-leaking failed ActionResult and does not revalidate", async () => {
    currentUserId = "user-1";
    deleteThrows = new NotFoundError();

    const result = await deleteServiceRuleDefaultAction("default-1");

    expect(result.ok).toBe(false);
    expect(revalidateCalls).toEqual([]);
  });

  // Delete's payload IS the id (no wrapping object) — a non-string id (a
  // client sending `null` in its place) would otherwise reach
  // `deleteServiceRuleDefault` and only fail deep inside the query, rather
  // than at this boundary like the other two actions' malformed-payload case.
  test("a non-string id is rejected as a failed ActionResult, without reaching the service", async () => {
    currentUserId = "user-1";

    const result = await deleteServiceRuleDefaultAction(
      null as unknown as string,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.codes).toEqual(["invalidPayload"]);
    expect(deleteCalls).toHaveLength(0);
  });
});
