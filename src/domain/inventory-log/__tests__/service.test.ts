import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { firearm, inventoryLog, magazine } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import { expectRejects } from "@/src/test-support/assertions";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeMagazine,
} from "@/src/test-support/factories";
import * as service from "../service";
import { createLogEntry, listLogForParent, markInventoried } from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("inventory-log service (U3)", () => {
  let owner = "";
  let editor = "";
  let viewer = "";
  let stranger = "";

  beforeAll(async () => {
    owner = await createUser("logOwner");
    editor = await createUser("logEditor");
    viewer = await createUser("logViewer");
    stranger = await createUser("logStranger");
  });
  afterAll(async () => {
    await deleteUsers(owner, editor, viewer, stranger);
  });

  test("covers R9: creates and lists newest-first for a firearm", async () => {
    const fa = await makeFirearm(owner);
    await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "cleaned",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "lubed",
      occurredAt: "2026-03-01T00:00:00.000Z",
    });
    await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "inventoried",
      occurredAt: "2026-02-01T00:00:00.000Z",
    });

    const entries = await listLogForParent(owner, "firearm", fa.id);
    expect(entries.map((e) => e.eventType)).toEqual([
      "lubed",
      "inventoried",
      "cleaned",
    ]);
  });

  test("covers R9: creates and lists newest-first for a magazine", async () => {
    const mag = await makeMagazine(owner);
    await createLogEntry(owner, {
      parentType: "magazine",
      parentId: mag.id,
      eventType: "inventoried",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    await createLogEntry(owner, {
      parentType: "magazine",
      parentId: mag.id,
      eventType: "inventoried",
      occurredAt: "2026-04-01T00:00:00.000Z",
    });

    const entries = await listLogForParent(owner, "magazine", mag.id);
    expect(entries.map((e) => e.occurredAt.toISOString())).toEqual([
      "2026-04-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  test("covers AE1/R6/R7: an edit-grantee on a firearm creates an entry as themselves", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    const created = await createLogEntry(editor, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "cleaned",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(created.actorId).toBe(editor);
  });

  test("covers R7/KTD2: on a magazine, a view grantee is rejected; only the owner can log", async () => {
    const mag = await makeMagazine(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "magazine",
      parentId: mag.id,
      permission: "view",
    });
    await expect(
      createLogEntry(viewer, {
        parentType: "magazine",
        parentId: mag.id,
        eventType: "inventoried",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    const created = await createLogEntry(owner, {
      parentType: "magazine",
      parentId: mag.id,
      eventType: "inventoried",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(created.actorId).toBe(owner);
  });

  test("covers AE3/R8: a view-grantee on a firearm can list but create throws NotAuthorizedError", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "inventoried",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await listLogForParent(viewer, "firearm", fa.id)).toHaveLength(1);
    await expect(
      createLogEntry(viewer, {
        parentType: "firearm",
        parentId: fa.id,
        eventType: "cleaned",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("a stranger with no visibility gets NotFoundError on create and list", async () => {
    const fa = await makeFirearm(owner);
    await expect(
      createLogEntry(stranger, {
        parentType: "firearm",
        parentId: fa.id,
        eventType: "cleaned",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listLogForParent(stranger, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("covers AE2/R3: cleaned on a magazine throws ValidationError and writes no row", async () => {
    const mag = await makeMagazine(owner);
    await expect(
      createLogEntry(owner, {
        parentType: "magazine",
        parentId: mag.id,
        eventType: "cleaned",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const entries = await listLogForParent(owner, "magazine", mag.id);
    expect(entries).toHaveLength(0);
  });

  test("R3 backstop: a raw insert with an invalid (parent_type, event_type) pair is rejected by the DB CHECK", async () => {
    const mag = await makeMagazine(owner);
    await expectRejects(() =>
      db.insert(inventoryLog).values({
        parentType: "magazine",
        parentId: mag.id,
        eventType: "cleaned",
        actorId: owner,
      }),
    );
  });

  test("covers R13: deleting the parent firearm removes its log entries", async () => {
    const fa = await makeFirearm(owner);
    await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "cleaned",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    await db.delete(firearm).where(eq(firearm.id, fa.id));
    const rows = await db
      .select()
      .from(inventoryLog)
      .where(eq(inventoryLog.parentId, fa.id));
    expect(rows).toHaveLength(0);
  });

  test("covers R13: deleting the parent magazine removes its log entries", async () => {
    const mag = await makeMagazine(owner);
    await createLogEntry(owner, {
      parentType: "magazine",
      parentId: mag.id,
      eventType: "inventoried",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    await db.delete(magazine).where(eq(magazine.id, mag.id));
    const rows = await db
      .select()
      .from(inventoryLog)
      .where(eq(inventoryLog.parentId, mag.id));
    expect(rows).toHaveLength(0);
  });

  test("covers R10: markInventoried creates exactly one inventoried entry ~now", async () => {
    const fa = await makeFirearm(owner);
    const before = Date.now();
    const created = await markInventoried(owner, "firearm", fa.id);
    const after = Date.now();
    expect(created.eventType).toBe("inventoried");
    expect(created.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(created.occurredAt.getTime()).toBeLessThanOrEqual(after);

    const entries = await listLogForParent(owner, "firearm", fa.id);
    expect(entries).toHaveLength(1);
  });

  test("covers R10: a view-grantee's markInventoried on a firearm is rejected", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await expect(
      markInventoried(viewer, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("covers R4: the service module exports no update/delete function", () => {
    expect("updateLogEntry" in service).toBe(false);
    expect("deleteLogEntry" in service).toBe(false);
  });
});
