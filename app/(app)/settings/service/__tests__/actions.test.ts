import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { ValidationError } from "@/src/domain/errors";
import type {
  ServiceRuleDefaultInput,
  ServiceRuleDefaultRow,
  ServiceRuleDefaultUpdateInput,
} from "@/src/domain/service-intervals/rules-service";

/**
 * Server-action unit tests for the service-defaults settings surface (U7).
 * Mocks the session and the domain service (`mock.module`, mirroring
 * `app/(app)/firearms/__tests__/documents-actions.test.ts`) rather than
 * hitting the DB — this only exercises the `"use server"` action boundary:
 * auth gating and `ActionResult` mapping. Rules-service behavior itself
 * (validation, owner-scoping, duplicate names) is covered by
 * `src/domain/service-intervals/__tests__/rules-service.test.ts`.
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

mock.module("@/src/domain/service-intervals/rules-service", () => ({
  createServiceRuleDefault: async (
    actorId: string,
    input: ServiceRuleDefaultInput,
  ) => {
    createCalls.push({ actorId, input });
    if (createThrows) throw createThrows;
    return createResult;
  },
  updateServiceRuleDefault: async (
    actorId: string,
    id: string,
    input: ServiceRuleDefaultUpdateInput,
  ) => {
    updateCalls.push({ actorId, id, input });
    if (updateThrows) throw updateThrows;
    return updateResult;
  },
  deleteServiceRuleDefault: async (actorId: string, id: string) => {
    deleteCalls.push({ actorId, id });
    if (deleteThrows) throw deleteThrows;
  },
}));

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
});
