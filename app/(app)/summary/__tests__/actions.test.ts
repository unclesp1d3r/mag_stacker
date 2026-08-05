import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { NotFoundError } from "@/src/auth/errors";
import { ValidationError } from "@/src/domain/errors";
import * as eventsService from "@/src/domain/service-intervals/events-service";

/**
 * Server-action unit tests for `markServicedBulkAction` (R16, the `/summary`
 * bulk mark-serviced surface). Mocks the session and spies on
 * `logServiceEventsBulk` (mirroring `firearms/__tests__/service-actions.test.ts`'s
 * `spyOn` approach) rather than hitting the DB — this only exercises the
 * `"use server"` action boundary: auth gating, forwarding, and `ActionResult`
 * mapping. NOT mocked here: `@/src/db/client` — `app/(app)/settings/__tests__/actions.test.ts`
 * already globally stubs that module with `mock.module`, and since `bun test app`
 * runs every file in one process, that stub outlives its own file and would
 * silently break a real-DB test in this file too (confirmed by direct repro:
 * `db.insert is not a function`). The owner-only/edit-grantee authorization
 * split itself is a real DB-dependent property of `logServiceEventsBulk`, so
 * it's covered where it belongs — `src/domain/service-intervals/__tests__/events-service.test.ts`,
 * which owns real (Testcontainers) DB coverage for this domain function,
 * including its bulk path's owner/edit-grantee/view-grantee/accessory-owner
 * cases. This file only proves the action forwards the resolved actor id and
 * input to that already-tested function, and maps its outcomes without
 * leaking internals.
 */

let currentUserId: string | null = null;
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () => (currentUserId ? { id: currentUserId } : null),
}));

let revalidateCalls: string[] = [];
mock.module("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidateCalls.push(path);
  },
}));

const { markServicedBulkAction } = await import("../actions");

describe("markServicedBulkAction", () => {
  let logServiceEventsBulkSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    currentUserId = null;
    revalidateCalls = [];
    logServiceEventsBulkSpy = spyOn(
      eventsService,
      "logServiceEventsBulk",
    ).mockResolvedValue([
      { id: "event-1", ruleName: "Cleaning" },
    ] as unknown as eventsService.ServiceEventRow[]);
  });

  afterEach(() => {
    logServiceEventsBulkSpy.mockRestore();
  });

  test("rejects an unauthenticated caller without touching the service", async () => {
    currentUserId = null;

    const result = await markServicedBulkAction(
      [{ parentType: "firearm", parentId: "fa-1", ruleName: "Cleaning" }],
      "2026-04-01",
    );

    expect(result.ok).toBe(false);
    expect(logServiceEventsBulkSpy).not.toHaveBeenCalled();
  });

  test("happy path across several items: forwards the resolved actor, items, date, and notes, and revalidates every affected path", async () => {
    currentUserId = "user-1";
    const items = [
      {
        parentType: "firearm" as const,
        parentId: "fa-1",
        ruleName: "Cleaning",
      },
      {
        parentType: "firearm" as const,
        parentId: "fa-2",
        ruleName: "Cleaning",
      },
      { parentType: "accessory" as const, parentId: "acc-1", ruleName: "Lens" },
    ];

    const result = await markServicedBulkAction(
      items,
      "2026-04-01",
      "Spring clean",
    );

    expect(result.ok).toBe(true);
    expect(logServiceEventsBulkSpy).toHaveBeenCalledWith("user-1", {
      items,
      servicedOn: "2026-04-01",
      notes: "Spring clean",
    });
    expect(revalidateCalls).toContain("/summary");
    expect(revalidateCalls).toContain("/firearms");
    expect(revalidateCalls).toContain("/accessories");
  });

  test("the whole-batch rejection when one item is unauthorized maps to a non-leaking ActionResult and revalidates nothing", async () => {
    currentUserId = "user-1";
    logServiceEventsBulkSpy.mockImplementation(() => {
      throw new NotFoundError();
    });

    const result = await markServicedBulkAction(
      [{ parentType: "firearm", parentId: "fa-1", ruleName: "Cleaning" }],
      "2026-04-01",
    );

    expect(result.ok).toBe(false);
    expect(revalidateCalls).toEqual([]);
  });

  test("a future servicedOn maps a thrown ValidationError to a failed ActionResult with codes", async () => {
    currentUserId = "user-1";
    logServiceEventsBulkSpy.mockImplementation(() => {
      throw new ValidationError(["servicedOnInFuture"]);
    });

    const result = await markServicedBulkAction(
      [{ parentType: "firearm", parentId: "fa-1", ruleName: "Cleaning" }],
      "2099-01-01",
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.codes).toEqual(["servicedOnInFuture"]);
    expect(revalidateCalls).toEqual([]);
  });
});
