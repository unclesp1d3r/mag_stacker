import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { serviceEvent } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  makeAccessory,
  makeFirearm,
  makeServiceEvent,
} from "@/src/test-support/factories";
import { MAX_BULK_SERVICE_ITEMS } from "../constants";
import { getItemDueState } from "../due-service";
import {
  type BulkServiceItem,
  deleteServiceEvent,
  listServiceHistory,
  logServiceEvent,
  logServiceEventsBulk,
  resolveServiceEventParent,
  type ServiceEventUpdateInput,
  updateServiceEvent,
} from "../events-service";
import { createItemRule, updateItemRule } from "../rules-service";

/** Local-frame date fixture (KTD5) — never a UTC `...Z` literal. */
function localDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

/**
 * Events-service integration tests (service-intervals plan, U4). Each test
 * creates its own owner(s), matching the isolation style established in
 * `rules-service.test.ts`.
 *
 * F2 fix: `logServiceEvent`/`logServiceEventsBulk` now confirm `ruleName`
 * resolves against the item's CURRENT effective rule set before writing, so
 * every test below that expects a successful write first arms the target
 * rule with `createItemRule` — matching how the real log-service flow only
 * ever offers a `ruleName` already showing in the item's resolved due state
 * (`log-service-form.tsx`'s doc comment: "`ruleName` is fixed by which
 * rule's 'Log service' button opened this form").
 */
describe("service-intervals events-service (U4)", () => {
  const createdUsers: string[] = [];

  afterAll(async () => {
    await deleteUsers(...createdUsers);
  });

  async function newOwner(label: string): Promise<string> {
    const id = await createUser(label);
    createdUsers.push(id);
    return id;
  }

  /** Arms an item-only "Cleaning" rule so a subsequent log-service call resolves (F2). */
  async function armCleaningRule(
    owner: string,
    parentType: "firearm" | "accessory",
    parentId: string,
  ): Promise<void> {
    await createItemRule(owner, parentType, parentId, {
      name: "Cleaning",
      intervalRounds: 500,
    });
  }

  function isoDateOffset(daysFromNow: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  test("logs a firearm service event recording the given rule, date, and notes", async () => {
    const owner = await newOwner("u4evOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await armCleaningRule(owner, "firearm", fa.id);

    const event = await logServiceEvent(owner, "firearm", fa.id, {
      ruleName: "Cleaning",
      servicedOn: "2026-03-01",
      notes: "Full field strip",
    });

    expect(event).toMatchObject({
      firearmId: fa.id,
      accessoryId: null,
      ruleName: "Cleaning",
      servicedOn: "2026-03-01",
      actorId: owner,
      notes: "Full field strip",
    });
  });

  test("an edit-grantee can log service on a shared firearm; the event records the grantee as actor", async () => {
    const owner = await newOwner("u4evOwner2");
    const editor = await newOwner("u4evEditor");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await armCleaningRule(owner, "firearm", fa.id);
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });

    const event = await logServiceEvent(editor, "firearm", fa.id, {
      ruleName: "Cleaning",
      servicedOn: "2026-03-02",
    });

    expect(event.actorId).toBe(editor);
  });

  test("a view-grantee on a shared firearm cannot log service", async () => {
    const owner = await newOwner("u4evOwner3");
    const viewer = await newOwner("u4evViewer");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });

    await expect(
      logServiceEvent(viewer, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-03-02",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("a non-owner cannot log service on an accessory even when they can see the firearm it is mounted to", async () => {
    const owner = await newOwner("u4evAccOwner");
    const viewer = await newOwner("u4evAccViewer");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const acc = await makeAccessory(owner, { currentFirearmId: fa.id });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });

    await expect(
      logServiceEvent(viewer, "accessory", acc.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-03-02",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const rows = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.accessoryId, acc.id));
    expect(rows).toHaveLength(0);
  });

  test("an invalid event (empty rule name, empty date) throws ValidationError and writes no row", async () => {
    const owner = await newOwner("u4evInvalidOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });

    await expect(
      logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "   ",
        servicedOn: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const rows = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(rows).toHaveLength(0);
  });

  test("a servicedOn more than one day in the future throws ValidationError and writes no row (U8 log-service form contract; F1's one-day timezone tolerance)", async () => {
    const owner = await newOwner("u4evFutureOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await armCleaningRule(owner, "firearm", fa.id);

    await expect(
      logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: isoDateOffset(2),
      }),
    ).rejects.toMatchObject({ codes: ["servicedOnInFuture"] });

    const rows = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(rows).toHaveLength(0);
  });

  test("a servicedOn exactly one day in the future is accepted (F1 fix: absorbs a submitter whose local day genuinely runs ahead of the server's)", async () => {
    const owner = await newOwner("u4evTomorrowOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await armCleaningRule(owner, "firearm", fa.id);
    const tomorrow = isoDateOffset(1);

    const event = await logServiceEvent(owner, "firearm", fa.id, {
      ruleName: "Cleaning",
      servicedOn: tomorrow,
    });

    expect(event.servicedOn).toBe(tomorrow);
  });

  test("covers R16: a bulk mark-serviced call across several items writes one event per item-and-rule pair with the given date", async () => {
    const owner = await newOwner("u4bulkOwner");
    const fa1 = await makeFirearm(owner, { type: "rifle" });
    const fa2 = await makeFirearm(owner, { type: "pistol" });
    const acc = await makeAccessory(owner, { currentFirearmId: fa1.id });
    await armCleaningRule(owner, "firearm", fa1.id);
    await armCleaningRule(owner, "firearm", fa2.id);
    await armCleaningRule(owner, "accessory", acc.id);

    const events = await logServiceEventsBulk(owner, {
      items: [
        { parentType: "firearm", parentId: fa1.id, ruleName: "Cleaning" },
        { parentType: "firearm", parentId: fa2.id, ruleName: "Cleaning" },
        { parentType: "accessory", parentId: acc.id, ruleName: "Cleaning" },
      ],
      servicedOn: "2026-04-01",
      notes: "Bulk spring clean",
    });

    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.servicedOn).toBe("2026-04-01");
      expect(event.ruleName).toBe("Cleaning");
      expect(event.notes).toBe("Bulk spring clean");
    }
    expect(
      events
        .map((e) => e.firearmId)
        .filter(Boolean)
        .sort(),
    ).toEqual([fa1.id, fa2.id].sort());
    expect(events.find((e) => e.accessoryId === acc.id)).toBeDefined();
  });

  test("a bulk mark-serviced call containing one unauthorized item writes nothing at all", async () => {
    const owner = await newOwner("u4bulkUnauthOwner");
    const stranger = await newOwner("u4bulkUnauthStranger");
    const ownFa = await makeFirearm(owner, { type: "rifle" });
    const strangerFa = await makeFirearm(stranger, { type: "rifle" });

    await expect(
      logServiceEventsBulk(owner, {
        items: [
          { parentType: "firearm", parentId: ownFa.id, ruleName: "Cleaning" },
          {
            parentType: "firearm",
            parentId: strangerFa.id,
            ruleName: "Cleaning",
          },
        ],
        servicedOn: "2026-04-02",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const rows = await db
      .select()
      .from(serviceEvent)
      .where(
        and(
          eq(serviceEvent.firearmId, ownFa.id),
          eq(serviceEvent.ruleName, "Cleaning"),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  test("a view-grantee's bulk mark-serviced call is rejected with NotAuthorizedError (not NotFoundError) and writes nothing — proves the batched authorization preserves the same per-item outcome as the single-event path", async () => {
    const owner = await newOwner("u4bulkViewOwner");
    const viewer = await newOwner("u4bulkViewViewer");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });

    await expect(
      logServiceEventsBulk(viewer, {
        items: [
          { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
        ],
        servicedOn: "2026-04-02",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    const rows = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(rows).toHaveLength(0);
  });

  test("an edit-grantee's bulk mark-serviced call across shared firearms succeeds, matching what the single-event path already allows them", async () => {
    const owner = await newOwner("u4bulkEditOwner");
    const editor = await newOwner("u4bulkEditor");
    const fa1 = await makeFirearm(owner, { type: "rifle" });
    const fa2 = await makeFirearm(owner, { type: "pistol" });
    await armCleaningRule(owner, "firearm", fa1.id);
    await armCleaningRule(owner, "firearm", fa2.id);
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa1.id,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa2.id,
      permission: "edit",
    });

    const events = await logServiceEventsBulk(editor, {
      items: [
        { parentType: "firearm", parentId: fa1.id, ruleName: "Cleaning" },
        { parentType: "firearm", parentId: fa2.id, ruleName: "Cleaning" },
      ],
      servicedOn: "2026-04-03",
    });

    expect(events).toHaveLength(2);
    for (const event of events) expect(event.actorId).toBe(editor);
  });

  test("an edit-grantee's bulk mark-serviced call rejects when it includes an accessory they don't own, even though they can edit the firearm it's mounted to, and writes nothing", async () => {
    const owner = await newOwner("u4bulkAccSplitOwner");
    const editor = await newOwner("u4bulkAccSplitEditor");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const acc = await makeAccessory(owner, { currentFirearmId: fa.id });
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });

    await expect(
      logServiceEventsBulk(editor, {
        items: [
          { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
          { parentType: "accessory", parentId: acc.id, ruleName: "Cleaning" },
        ],
        servicedOn: "2026-04-03",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const rows = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(rows).toHaveLength(0);
  });

  test("an empty bulk items list writes nothing and returns an empty array", async () => {
    const owner = await newOwner("u4bulkEmptyOwner");
    const events = await logServiceEventsBulk(owner, {
      items: [],
      servicedOn: "2026-04-04",
    });
    expect(events).toEqual([]);
  });

  test("service history returns events newest first and names the rule each serviced", async () => {
    const owner = await newOwner("u4historyOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      intervalRounds: 500,
    });
    await createItemRule(owner, "firearm", fa.id, {
      name: "Barrel",
      intervalRounds: 5000,
    });
    await createItemRule(owner, "firearm", fa.id, {
      name: "Lubrication",
      intervalRounds: 250,
    });

    await logServiceEvent(owner, "firearm", fa.id, {
      ruleName: "Cleaning",
      servicedOn: "2026-01-01",
    });
    await logServiceEvent(owner, "firearm", fa.id, {
      ruleName: "Barrel",
      servicedOn: "2026-03-01",
    });
    await logServiceEvent(owner, "firearm", fa.id, {
      ruleName: "Lubrication",
      servicedOn: "2026-02-01",
    });

    const history = await listServiceHistory(owner, "firearm", fa.id);
    expect(history.map((e) => e.ruleName)).toEqual([
      "Barrel",
      "Lubrication",
      "Cleaning",
    ]);
  });

  test("a view-grantee can read a shared firearm's service history", async () => {
    const owner = await newOwner("u4historyViewOwner");
    const viewer = await newOwner("u4historyViewer");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await armCleaningRule(owner, "firearm", fa.id);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await logServiceEvent(owner, "firearm", fa.id, {
      ruleName: "Cleaning",
      servicedOn: "2026-01-01",
    });

    const history = await listServiceHistory(viewer, "firearm", fa.id);
    expect(history).toHaveLength(1);
  });

  test("a firearm's view-grantee cannot read an accessory's service history, even when mounted on the shared firearm", async () => {
    const owner = await newOwner("u4historyAccOwner");
    const viewer = await newOwner("u4historyAccViewer");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const acc = await makeAccessory(owner, { currentFirearmId: fa.id });
    await armCleaningRule(owner, "accessory", acc.id);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await logServiceEvent(owner, "accessory", acc.id, {
      ruleName: "Cleaning",
      servicedOn: "2026-01-01",
    });

    await expect(
      listServiceHistory(viewer, "accessory", acc.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // ---- F2: a stale (renamed-away) rule name is rejected, not written ----

  describe("F2: ruleName must resolve against the item's current effective rule set", () => {
    test("logServiceEvent rejects a rule name renamed away since it was captured, and writes nothing", async () => {
      const owner = await newOwner("u4f2Owner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      const rule = await createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalRounds: 500,
      });
      await updateItemRule(owner, "firearm", fa.id, rule.id, {
        name: "Deep Clean",
        intervalRounds: 500,
      });

      await expect(
        logServiceEvent(owner, "firearm", fa.id, {
          ruleName: "Cleaning",
          servicedOn: "2026-01-01",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.firearmId, fa.id));
      expect(rows).toHaveLength(0);
    });

    test("logServiceEventsBulk rejects a rule name renamed away since it was captured, and writes nothing", async () => {
      const owner = await newOwner("u4f2BulkOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      const rule = await createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalRounds: 500,
      });
      await updateItemRule(owner, "firearm", fa.id, rule.id, {
        name: "Deep Clean",
        intervalRounds: 500,
      });

      await expect(
        logServiceEventsBulk(owner, {
          items: [
            { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
          ],
          servicedOn: "2026-01-02",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.firearmId, fa.id));
      expect(rows).toHaveLength(0);
    });
  });

  // ---- F6: the bulk batch-size cap ----

  describe("F6: logServiceEventsBulk bounds batch size", () => {
    test(`a batch of exactly MAX_BULK_SERVICE_ITEMS (${MAX_BULK_SERVICE_ITEMS}) succeeds`, async () => {
      const owner = await newOwner("u4f6AtCapOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);

      const items: BulkServiceItem[] = Array.from(
        { length: MAX_BULK_SERVICE_ITEMS },
        () => ({
          parentType: "firearm",
          parentId: fa.id,
          ruleName: "Cleaning",
        }),
      );

      const events = await logServiceEventsBulk(owner, {
        items,
        servicedOn: "2026-01-03",
      });
      expect(events).toHaveLength(MAX_BULK_SERVICE_ITEMS);
    });

    test(`a batch one over MAX_BULK_SERVICE_ITEMS (${MAX_BULK_SERVICE_ITEMS + 1}) is rejected before any write`, async () => {
      const owner = await newOwner("u4f6OverCapOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);

      const items: BulkServiceItem[] = Array.from(
        { length: MAX_BULK_SERVICE_ITEMS + 1 },
        () => ({
          parentType: "firearm",
          parentId: fa.id,
          ruleName: "Cleaning",
        }),
      );

      await expect(
        logServiceEventsBulk(owner, { items, servicedOn: "2026-01-04" }),
      ).rejects.toBeInstanceOf(ValidationError);

      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.firearmId, fa.id));
      expect(rows).toHaveLength(0);
    });
  });

  // ---- F8: duplicate item+rule pairs in one bulk call ----

  test("F8: duplicate item+rule pairs in one bulk call each write their own event (no dedup)", async () => {
    const owner = await newOwner("u4f8DupOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await armCleaningRule(owner, "firearm", fa.id);

    const events = await logServiceEventsBulk(owner, {
      items: [
        { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
        { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
      ],
      servicedOn: "2026-01-05",
    });

    expect(events).toHaveLength(2);
    const rows = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(rows).toHaveLength(2);
  });

  // ---- correction path: updateServiceEvent / deleteServiceEvent ----
  //
  // U4 originally shipped only logServiceEvent/logServiceEventsBulk/
  // listServiceHistory — a mis-logged event had no in-app fix. These two
  // functions close that gap. Date fixtures below are ISO strings compared
  // against an explicit, pinned `asOf` (KTD5's local-frame convention,
  // mirroring `due-service.test.ts`'s `localDate` helper) so due-state
  // assertions never depend on the moment the suite happens to run.

  describe("correction path: updateServiceEvent / deleteServiceEvent", () => {
    test("resolveServiceEventParent resolves a firearm-parented row and an accessory-parented row", () => {
      expect(
        resolveServiceEventParent({ firearmId: "fa-1", accessoryId: null }),
      ).toEqual({ parentType: "firearm", parentId: "fa-1" });
      expect(
        resolveServiceEventParent({ firearmId: null, accessoryId: "acc-1" }),
      ).toEqual({ parentType: "accessory", parentId: "acc-1" });
    });

    // The DB's exactly-one-parent CHECK (KTD2) forbids a real row from ever
    // having both FKs null, but `resolveServiceEventParent` now routes
    // through the shared `resolveParent` helper (rules-service.ts) for that
    // resolution — this pins the defensive fallback's behavior in the one
    // place it's exercisable at all: a plain object literal, not a real row.
    test("resolveServiceEventParent throws NotFoundError for a row with neither parent set", () => {
      expect(() =>
        resolveServiceEventParent({ firearmId: null, accessoryId: null }),
      ).toThrow(NotFoundError);
    });

    test("editing an event's date changes that rule's due state; editing only notes does not", async () => {
      const owner = await newOwner("u4corrDateOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalDays: 10,
      });
      const asOf = localDate(2026, 5, 30); // 2026-06-30

      const event = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-06-25", // 5 days before asOf — not due (threshold 10)
      });

      const before = await getItemDueState(owner, "firearm", fa.id, asOf);
      expect(before.find((r) => r.name === "Cleaning")?.due).toBe(false);

      const corrected = await updateServiceEvent(owner, event.id, {
        servicedOn: "2026-06-01", // 29 days before asOf — now past the threshold
      });
      expect(corrected).toMatchObject({
        id: event.id,
        ruleName: "Cleaning",
        servicedOn: "2026-06-01",
      });

      const afterDateEdit = await getItemDueState(
        owner,
        "firearm",
        fa.id,
        asOf,
      );
      const cleaningAfterDate = afterDateEdit.find(
        (r) => r.name === "Cleaning",
      );
      expect(cleaningAfterDate?.due).toBe(true);
      expect(cleaningAfterDate?.counts.days).toBe(29);

      // Editing ONLY notes must not move the measure-from date or due state.
      await updateServiceEvent(owner, event.id, {
        servicedOn: "2026-06-01",
        notes: "corrected note",
      });
      const afterNotesEdit = await getItemDueState(
        owner,
        "firearm",
        fa.id,
        asOf,
      );
      const cleaningAfterNotes = afterNotesEdit.find(
        (r) => r.name === "Cleaning",
      );
      expect(cleaningAfterNotes?.due).toBe(true);
      expect(cleaningAfterNotes?.counts.days).toBe(29);

      const history = await listServiceHistory(owner, "firearm", fa.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        servicedOn: "2026-06-01",
        notes: "corrected note",
      });
    });

    test("updateServiceEvent ignores any ruleName smuggled onto the input — an event's rule never changes via edit", async () => {
      const owner = await newOwner("u4corrRuleImmutableOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalDays: 10,
      });
      await createItemRule(owner, "firearm", fa.id, {
        name: "Barrel",
        intervalDays: 10,
      });
      const event = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      // `ServiceEventUpdateInput` has no `ruleName` field at all — this cast
      // simulates a caller that bypasses the type system, proving the
      // constraint holds at runtime too, not just at compile time.
      const sneaky = {
        servicedOn: "2026-01-02",
        ruleName: "Barrel",
      } as unknown as ServiceEventUpdateInput;

      const updated = await updateServiceEvent(owner, event.id, sneaky);
      expect(updated.ruleName).toBe("Cleaning");
    });

    test("deleting the newest event for a rule falls back to the previous event", async () => {
      const owner = await newOwner("u4corrFallbackPrevOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalDays: 10,
      });
      const asOf = localDate(2026, 5, 30); // 2026-06-30

      const older = await makeServiceEvent(
        { firearmId: fa.id },
        { ruleName: "Cleaning", servicedOn: "2026-06-01", actorId: owner },
      );
      const newest = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-06-25",
      });

      // Before deletion: measures from the NEWEST event (June 25) — not due.
      const before = await getItemDueState(owner, "firearm", fa.id, asOf);
      expect(before.find((r) => r.name === "Cleaning")?.due).toBe(false);

      const deleted = await deleteServiceEvent(owner, newest.id);
      expect(deleted.id).toBe(newest.id);

      // After deletion: falls back to the PREVIOUS event (June 1) — due.
      const after = await getItemDueState(owner, "firearm", fa.id, asOf);
      const cleaningAfter = after.find((r) => r.name === "Cleaning");
      expect(cleaningAfter?.due).toBe(true);
      expect(cleaningAfter?.counts.days).toBe(29);

      const history = await listServiceHistory(owner, "firearm", fa.id);
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(older.id);
    });

    test("deleting the only event for a rule falls back to the item's origin date", async () => {
      const owner = await newOwner("u4corrFallbackOriginOwner");
      const fa = await makeFirearm(owner, {
        type: "rifle",
        acquiredDate: "2026-01-01",
      });
      await createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalDays: 10,
      });
      const asOf = localDate(2026, 5, 30); // 2026-06-30

      const onlyEvent = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-06-25",
      });

      const before = await getItemDueState(owner, "firearm", fa.id, asOf);
      expect(before.find((r) => r.name === "Cleaning")?.due).toBe(false);

      await deleteServiceEvent(owner, onlyEvent.id);

      // No service event remains — falls back to the firearm's acquired date
      // (2026-01-01), 180 days before asOf, well past the 10-day threshold.
      const after = await getItemDueState(owner, "firearm", fa.id, asOf);
      const cleaningAfter = after.find((r) => r.name === "Cleaning");
      expect(cleaningAfter?.due).toBe(true);
      expect(cleaningAfter?.counts.days).toBe(180);

      const history = await listServiceHistory(owner, "firearm", fa.id);
      expect(history).toHaveLength(0);
    });

    test("an edit-grantee can edit and delete a service event on a shared firearm", async () => {
      const owner = await newOwner("u4corrEditGranteeOwner");
      const editor = await newOwner("u4corrEditGranteeEditor");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);
      await createGrant(db, {
        actorId: owner,
        granteeId: editor,
        parentType: "firearm",
        parentId: fa.id,
        permission: "edit",
      });
      const event = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      const updated = await updateServiceEvent(editor, event.id, {
        servicedOn: "2026-01-02",
        notes: "edited by grantee",
      });
      expect(updated.servicedOn).toBe("2026-01-02");

      await deleteServiceEvent(editor, event.id);
      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.id, event.id));
      expect(rows).toHaveLength(0);
    });

    test("a view-grantee cannot edit or delete a service event on a shared firearm", async () => {
      const owner = await newOwner("u4corrViewGranteeOwner");
      const viewer = await newOwner("u4corrViewGranteeViewer");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);
      await createGrant(db, {
        actorId: owner,
        granteeId: viewer,
        parentType: "firearm",
        parentId: fa.id,
        permission: "view",
      });
      const event = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      await expect(
        updateServiceEvent(viewer, event.id, { servicedOn: "2026-01-02" }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(deleteServiceEvent(viewer, event.id)).rejects.toBeInstanceOf(
        NotAuthorizedError,
      );

      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.id, event.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].servicedOn).toBe("2026-01-01");
    });

    test("a non-owner cannot edit or delete a service event on an accessory even when they can see the firearm it is mounted to", async () => {
      const owner = await newOwner("u4corrAccOwner");
      const viewer = await newOwner("u4corrAccViewer");
      const fa = await makeFirearm(owner, { type: "rifle" });
      const acc = await makeAccessory(owner, { currentFirearmId: fa.id });
      await armCleaningRule(owner, "accessory", acc.id);
      await createGrant(db, {
        actorId: owner,
        granteeId: viewer,
        parentType: "firearm",
        parentId: fa.id,
        permission: "edit",
      });
      const event = await logServiceEvent(owner, "accessory", acc.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      await expect(
        updateServiceEvent(viewer, event.id, { servicedOn: "2026-01-02" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteServiceEvent(viewer, event.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );

      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.id, event.id));
      expect(rows).toHaveLength(1);
    });

    test("editing or deleting an event the actor cannot see at all raises NotFoundError", async () => {
      const owner = await newOwner("u4corrStrangerOwner");
      const stranger = await newOwner("u4corrStranger");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);
      const event = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      await expect(
        updateServiceEvent(stranger, event.id, { servicedOn: "2026-01-02" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        deleteServiceEvent(stranger, event.id),
      ).rejects.toBeInstanceOf(NotFoundError);

      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.id, event.id));
      expect(rows).toHaveLength(1);
    });

    test("updating or deleting a nonexistent event id raises NotFoundError", async () => {
      const owner = await newOwner("u4corrMissingOwner");
      const missingId = "00000000-0000-0000-0000-000000000000";

      await expect(
        updateServiceEvent(owner, missingId, { servicedOn: "2026-01-02" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteServiceEvent(owner, missingId)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    test("editing to a servicedOn more than one day in the future throws ValidationError and writes no change", async () => {
      const owner = await newOwner("u4corrFutureOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);
      const event = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });

      await expect(
        updateServiceEvent(owner, event.id, {
          servicedOn: isoDateOffset(2),
        }),
      ).rejects.toMatchObject({ codes: ["servicedOnInFuture"] });

      const rows = await db
        .select()
        .from(serviceEvent)
        .where(eq(serviceEvent.id, event.id));
      expect(rows[0].servicedOn).toBe("2026-01-01");
    });

    test("editing to a servicedOn exactly one day in the future is accepted (same one-day tolerance as logging)", async () => {
      const owner = await newOwner("u4corrTomorrowOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);
      const event = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      });
      const tomorrow = isoDateOffset(1);

      const updated = await updateServiceEvent(owner, event.id, {
        servicedOn: tomorrow,
      });
      expect(updated.servicedOn).toBe(tomorrow);
    });
  });

  /**
   * `authorizeEventWritesBatch` (the bulk path's authorization) reimplements
   * firearm authorization inline using `visibleFirearmPermissions`, rather
   * than calling `authorizeEventWrite`/`authorizeUpdate` (the single path's
   * gate) in a loop. The doc comments above both functions claim the two
   * produce identical outcomes; these tests pin that claim down directly by
   * calling BOTH `logServiceEvent` and `logServiceEventsBulk` against the
   * SAME firearm with the SAME actor at each permission tier, so a future
   * change that loosens one path without the other fails a test instead of
   * silently drifting.
   */
  describe("authorization parity: logServiceEvent vs logServiceEventsBulk (same actor, same firearm)", () => {
    test("the owner succeeds identically via both paths", async () => {
      const owner = await newOwner("u4parityOwner");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);

      const single = await logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-05-01",
      });
      const [bulk] = await logServiceEventsBulk(owner, {
        items: [
          { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
        ],
        servicedOn: "2026-05-02",
      });

      expect(single.actorId).toBe(owner);
      expect(bulk.actorId).toBe(owner);
    });

    test("an edit-grantee succeeds identically via both paths", async () => {
      const owner = await newOwner("u4parityEditOwner");
      const editor = await newOwner("u4parityEditor");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await armCleaningRule(owner, "firearm", fa.id);
      await createGrant(db, {
        actorId: owner,
        granteeId: editor,
        parentType: "firearm",
        parentId: fa.id,
        permission: "edit",
      });

      const single = await logServiceEvent(editor, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: "2026-05-01",
      });
      const [bulk] = await logServiceEventsBulk(editor, {
        items: [
          { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
        ],
        servicedOn: "2026-05-02",
      });

      expect(single.actorId).toBe(editor);
      expect(bulk.actorId).toBe(editor);
    });

    test("a view-grantee is rejected identically (NotAuthorizedError) via both paths", async () => {
      const owner = await newOwner("u4parityViewOwner");
      const viewer = await newOwner("u4parityViewer");
      const fa = await makeFirearm(owner, { type: "rifle" });
      await createGrant(db, {
        actorId: owner,
        granteeId: viewer,
        parentType: "firearm",
        parentId: fa.id,
        permission: "view",
      });

      await expect(
        logServiceEvent(viewer, "firearm", fa.id, {
          ruleName: "Cleaning",
          servicedOn: "2026-05-01",
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(
        logServiceEventsBulk(viewer, {
          items: [
            { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
          ],
          servicedOn: "2026-05-01",
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });

    test("a stranger with no grant at all is rejected identically (NotFoundError) via both paths", async () => {
      const owner = await newOwner("u4parityStrangerOwner");
      const stranger = await newOwner("u4parityStranger");
      const fa = await makeFirearm(owner, { type: "rifle" });

      await expect(
        logServiceEvent(stranger, "firearm", fa.id, {
          ruleName: "Cleaning",
          servicedOn: "2026-05-01",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        logServiceEventsBulk(stranger, {
          items: [
            { parentType: "firearm", parentId: fa.id, ruleName: "Cleaning" },
          ],
          servicedOn: "2026-05-01",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
