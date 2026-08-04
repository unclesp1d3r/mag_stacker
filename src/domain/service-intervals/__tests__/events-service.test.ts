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
} from "@/src/test-support/factories";
import {
  listServiceHistory,
  logServiceEvent,
  logServiceEventsBulk,
} from "../events-service";

/**
 * Events-service integration tests (service-intervals plan, U4). Each test
 * creates its own owner(s), matching the isolation style established in
 * `rules-service.test.ts`.
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

  test("logs a firearm service event recording the given rule, date, and notes", async () => {
    const owner = await newOwner("u4evOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });

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

  test("a future servicedOn throws ValidationError and writes no row (U8 log-service form contract)", async () => {
    const owner = await newOwner("u4evFutureOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isoTomorrow = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, "0"),
      String(tomorrow.getDate()).padStart(2, "0"),
    ].join("-");

    await expect(
      logServiceEvent(owner, "firearm", fa.id, {
        ruleName: "Cleaning",
        servicedOn: isoTomorrow,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const rows = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(rows).toHaveLength(0);
  });

  test("covers R16: a bulk mark-serviced call across several items writes one event per item-and-rule pair with the given date", async () => {
    const owner = await newOwner("u4bulkOwner");
    const fa1 = await makeFirearm(owner, { type: "rifle" });
    const fa2 = await makeFirearm(owner, { type: "pistol" });
    const acc = await makeAccessory(owner, { currentFirearmId: fa1.id });

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
});
