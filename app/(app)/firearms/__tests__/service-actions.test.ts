import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { ValidationError } from "@/src/domain/errors";
import * as eventsService from "@/src/domain/service-intervals/events-service";
import * as rulesService from "@/src/domain/service-intervals/rules-service";

/**
 * Server-action unit tests for `service-actions.ts` (U8) — auth gating,
 * name-to-row resolution before a write, and `ActionResult` mapping.
 *
 * Uses `spyOn` on the real `rules-service`/`events-service` module
 * namespaces (mutating the live export in place) rather than
 * `mock.module(...)` on those two specifiers: `rules-service` is ALSO
 * `mock.module`-replaced, with a completely different shape, by
 * `settings/service/__tests__/actions.test.ts`. `mock.module` on a
 * specifier both files import materializes the module once and locks in
 * whichever mock resolved first for the rest of the `bun test` process
 * (confirmed by direct repro) — a second, differently-shaped
 * `mock.module` call on the same path from this file broke the OTHER
 * file's tests outright. `spyOn` sidesteps this: it overrides the named
 * export on the already-loaded module object directly, with no shared
 * "first-to-resolve-a-mocked-specifier-wins" registry involved, so the two
 * test files stop colliding.
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

const {
  logServiceEventAction,
  overrideServiceRuleAction,
  addItemOnlyRuleAction,
  resetServiceRuleAction,
  suppressServiceRuleAction,
  restoreServiceRuleAction,
} = await import("../service-actions");

type ServiceRuleRowLike = rulesService.ServiceRuleRow;

function ruleRow(id: string, name: string): ServiceRuleRowLike {
  return { id, name, suppressed: false } as ServiceRuleRowLike;
}

describe("service-actions (U8)", () => {
  let listItemRulesSpy: ReturnType<typeof spyOn>;
  let createItemRuleSpy: ReturnType<typeof spyOn>;
  let updateItemRuleSpy: ReturnType<typeof spyOn>;
  let deleteItemRuleSpy: ReturnType<typeof spyOn>;
  let logServiceEventSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    currentUserId = null;
    revalidateCalls = [];
    listItemRulesSpy = spyOn(rulesService, "listItemRules").mockResolvedValue(
      [],
    );
    createItemRuleSpy = spyOn(rulesService, "createItemRule").mockResolvedValue(
      ruleRow("new-rule", "unused"),
    );
    updateItemRuleSpy = spyOn(rulesService, "updateItemRule").mockResolvedValue(
      ruleRow("updated-rule", "unused"),
    );
    deleteItemRuleSpy = spyOn(rulesService, "deleteItemRule").mockResolvedValue(
      undefined,
    );
    logServiceEventSpy = spyOn(
      eventsService,
      "logServiceEvent",
    ).mockResolvedValue({ id: "event-1", ruleName: "Cleaning" } as never);
  });

  afterEach(() => {
    listItemRulesSpy.mockRestore();
    createItemRuleSpy.mockRestore();
    updateItemRuleSpy.mockRestore();
    deleteItemRuleSpy.mockRestore();
    logServiceEventSpy.mockRestore();
  });

  describe("logServiceEventAction", () => {
    test("rejects an unauthenticated caller without touching the service", async () => {
      currentUserId = null;

      const result = await logServiceEventAction("firearm", "fa-1", {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      expect(result.ok).toBe(false);
      expect(logServiceEventSpy).not.toHaveBeenCalled();
    });

    test("forwards the resolved actor id and input, and revalidates the firearm's path", async () => {
      currentUserId = "user-1";

      const result = await logServiceEventAction("firearm", "fa-1", {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
        notes: "Field strip",
      });

      expect(result.ok).toBe(true);
      expect(logServiceEventSpy).toHaveBeenCalledWith(
        "user-1",
        "firearm",
        "fa-1",
        {
          ruleName: "Cleaning",
          servicedOn: "2026-01-01",
          notes: "Field strip",
        },
      );
      expect(revalidateCalls).toContain("/firearms/fa-1");
    });

    test("revalidates the accessory's path for an accessory parent", async () => {
      currentUserId = "user-1";

      await logServiceEventAction("accessory", "acc-1", {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      expect(revalidateCalls).toContain("/accessories/acc-1");
    });

    test("maps a thrown ValidationError to a failed ActionResult with codes", async () => {
      currentUserId = "user-1";
      logServiceEventSpy.mockImplementation(() => {
        throw new ValidationError(["servicedOnInFuture"]);
      });

      const result = await logServiceEventAction("firearm", "fa-1", {
        ruleName: "Cleaning",
        servicedOn: "2099-01-01",
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.codes).toEqual([
        "servicedOnInFuture",
      ]);
    });
  });

  describe("overrideServiceRuleAction", () => {
    test("creates a new item rule when the item has no entry for that name yet", async () => {
      currentUserId = "user-1";
      listItemRulesSpy.mockResolvedValue([]);

      const result = await overrideServiceRuleAction("firearm", "fa-1", {
        name: "Barrel",
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 4000,
      });

      expect(result.ok).toBe(true);
      expect(createItemRuleSpy).toHaveBeenCalledWith(
        "user-1",
        "firearm",
        "fa-1",
        {
          name: "Barrel",
          intervalDays: null,
          intervalSessions: null,
          intervalRounds: 4000,
          suppressed: false,
        },
        // The empty sibling list `findItemRuleByName`'s `listItemRules` call
        // already resolved, threaded through so the write skips reloading it.
        [],
      );
      expect(updateItemRuleSpy).not.toHaveBeenCalled();
      expect(revalidateCalls).toContain("/firearms/fa-1");
    });

    test("updates the existing item rule by id when one already exists for that name", async () => {
      currentUserId = "user-1";
      const siblings = [ruleRow("rule-42", "Barrel")];
      listItemRulesSpy.mockResolvedValue(siblings);

      const result = await overrideServiceRuleAction("firearm", "fa-1", {
        name: "Barrel",
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 3000,
      });

      expect(result.ok).toBe(true);
      expect(updateItemRuleSpy).toHaveBeenCalledWith(
        "user-1",
        "firearm",
        "fa-1",
        "rule-42",
        {
          name: "Barrel",
          intervalDays: null,
          intervalSessions: null,
          intervalRounds: 3000,
          suppressed: false,
        },
        // The sibling list (including the row itself) already resolved by
        // `findItemRuleByName`, threaded through to skip a reload.
        siblings,
      );
      expect(createItemRuleSpy).not.toHaveBeenCalled();
    });
  });

  describe("addItemOnlyRuleAction", () => {
    test("creates an unsuppressed rule and revalidates", async () => {
      currentUserId = "user-1";

      const result = await addItemOnlyRuleAction("accessory", "acc-1", {
        name: "Lens cleaning",
        intervalDays: 90,
        intervalSessions: null,
        intervalRounds: null,
      });

      expect(result.ok).toBe(true);
      expect(createItemRuleSpy).toHaveBeenCalledWith(
        "user-1",
        "accessory",
        "acc-1",
        {
          name: "Lens cleaning",
          intervalDays: 90,
          intervalSessions: null,
          intervalRounds: null,
          suppressed: false,
        },
      );
      expect(revalidateCalls).toContain("/accessories/acc-1");
    });
  });

  describe("resetServiceRuleAction", () => {
    test("deletes the existing item rule by its resolved id", async () => {
      currentUserId = "user-1";
      listItemRulesSpy.mockResolvedValue([ruleRow("rule-7", "Barrel")]);

      const result = await resetServiceRuleAction("firearm", "fa-1", "Barrel");

      expect(result.ok).toBe(true);
      expect(deleteItemRuleSpy).toHaveBeenCalledWith(
        "user-1",
        "firearm",
        "fa-1",
        "rule-7",
      );
    });

    test("returns a non-leaking error and deletes nothing when no override exists for that name", async () => {
      currentUserId = "user-1";
      listItemRulesSpy.mockResolvedValue([]);

      const result = await resetServiceRuleAction("firearm", "fa-1", "Barrel");

      expect(result.ok).toBe(false);
      expect(deleteItemRuleSpy).not.toHaveBeenCalled();
    });
  });

  describe("suppressServiceRuleAction", () => {
    test("updates the existing row to suppressed when one exists", async () => {
      currentUserId = "user-1";
      const siblings = [ruleRow("rule-9", "Cleaning")];
      listItemRulesSpy.mockResolvedValue(siblings);

      const result = await suppressServiceRuleAction(
        "firearm",
        "fa-1",
        "Cleaning",
      );

      expect(result.ok).toBe(true);
      expect(updateItemRuleSpy).toHaveBeenCalledWith(
        "user-1",
        "firearm",
        "fa-1",
        "rule-9",
        { name: "Cleaning", suppressed: true },
        // Already-resolved siblings threaded through to skip a reload.
        siblings,
      );
      expect(createItemRuleSpy).not.toHaveBeenCalled();
    });

    test("creates a new suppressed row when the item has no entry yet (suppressing an inherited default)", async () => {
      currentUserId = "user-1";
      listItemRulesSpy.mockResolvedValue([]);

      const result = await suppressServiceRuleAction(
        "firearm",
        "fa-1",
        "Cleaning",
      );

      expect(result.ok).toBe(true);
      expect(createItemRuleSpy).toHaveBeenCalledWith(
        "user-1",
        "firearm",
        "fa-1",
        { name: "Cleaning", suppressed: true },
        // Already-resolved (empty) siblings threaded through to skip a reload.
        [],
      );
      expect(updateItemRuleSpy).not.toHaveBeenCalled();
    });
  });

  describe("restoreServiceRuleAction", () => {
    test("deletes the suppressed row by its resolved id", async () => {
      currentUserId = "user-1";
      listItemRulesSpy.mockResolvedValue([ruleRow("rule-3", "Cleaning")]);

      const result = await restoreServiceRuleAction(
        "firearm",
        "fa-1",
        "Cleaning",
      );

      expect(result.ok).toBe(true);
      expect(deleteItemRuleSpy).toHaveBeenCalledWith(
        "user-1",
        "firearm",
        "fa-1",
        "rule-3",
      );
    });

    test("returns a non-leaking error when nothing is suppressed under that name", async () => {
      currentUserId = "user-1";
      listItemRulesSpy.mockResolvedValue([]);

      const result = await restoreServiceRuleAction(
        "firearm",
        "fa-1",
        "Cleaning",
      );

      expect(result.ok).toBe(false);
      expect(deleteItemRuleSpy).not.toHaveBeenCalled();
    });
  });
});
