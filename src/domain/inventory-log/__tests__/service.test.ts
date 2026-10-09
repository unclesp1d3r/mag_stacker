import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { ammo, firearm, inventoryLog, magazine } from "@/src/db/schema";
import { deleteAmmo, getAmmo, updateAmmo } from "@/src/domain/ammo/service";
import { ValidationError } from "@/src/domain/errors";
import { expectRejects } from "@/src/test-support/assertions";
import {
  createUser,
  deleteUsers,
  makeAmmo,
  makeFirearm,
  makeLogEntry,
  makeMagazine,
} from "@/src/test-support/factories";
import * as service from "../service";
import {
  createLogEntry,
  listLogForParent,
  markInventoried,
  reconcileAmmo,
} from "../service";

describe("inventory-log service (U3)", () => {
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
      eventType: "inventoried",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "inventoried",
      occurredAt: "2026-03-01T00:00:00.000Z",
    });
    await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "inventoried",
      occurredAt: "2026-02-01T00:00:00.000Z",
    });

    const entries = await listLogForParent(owner, "firearm", fa.id);
    expect(entries.map((e) => e.occurredAt.toISOString())).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
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
      eventType: "inventoried",
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
        eventType: "inventoried",
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
        eventType: "inventoried",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listLogForParent(stranger, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // Covers R13/KTD1/KTD7 (service-intervals plan, U5): cleaned/lubed are
  // retired event types entirely, not merely invalid on a magazine — a
  // firearm parent throws the same ValidationError a magazine always did.
  test("covers R13: cleaned throws ValidationError and writes no row (retired event type)", async () => {
    const fa = await makeFirearm(owner);
    await expect(
      createLogEntry(owner, {
        parentType: "firearm",
        parentId: fa.id,
        eventType: "cleaned",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const entries = await listLogForParent(owner, "firearm", fa.id);
    expect(entries).toHaveLength(0);
  });

  test("R3 backstop: the DB rejects a direct insert of a retired 'cleaned' row for a firearm after the CHECK was narrowed (U5)", async () => {
    const fa = await makeFirearm(owner);
    await expectRejects(() =>
      db.insert(inventoryLog).values({
        parentType: "firearm",
        parentId: fa.id,
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
      eventType: "inventoried",
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

  test("covers R2/R21: a future occurredAt via the service throws ValidationError and writes no row", async () => {
    const fa = await makeFirearm(owner);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await expect(
      createLogEntry(owner, {
        parentType: "firearm",
        parentId: fa.id,
        eventType: "inventoried",
        occurredAt: future,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const entries = await listLogForParent(owner, "firearm", fa.id);
    expect(entries).toHaveLength(0);
  });

  test("covers R5: omitting notes stores empty string, not null", async () => {
    const fa = await makeFirearm(owner);
    const created = await createLogEntry(owner, {
      parentType: "firearm",
      parentId: fa.id,
      eventType: "inventoried",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(created.notes).toBe("");
  });

  test("covers R10: markInventoried on a magazine creates exactly one inventoried entry", async () => {
    const mag = await makeMagazine(owner);
    const created = await markInventoried(owner, "magazine", mag.id);
    expect(created.eventType).toBe("inventoried");
    const entries = await listLogForParent(owner, "magazine", mag.id);
    expect(entries).toHaveLength(1);
  });

  test("covers R10: a view-grantee's markInventoried on a magazine is rejected", async () => {
    const mag = await makeMagazine(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "magazine",
      parentId: mag.id,
      permission: "view",
    });
    await expect(
      markInventoried(viewer, "magazine", mag.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("covers R9: same occurredAt breaks the tie by createdAt DESC", async () => {
    const fa = await makeFirearm(owner);
    const occurredAt = new Date("2026-01-01T00:00:00.000Z");
    const first = await makeLogEntry("firearm", fa.id, {
      actorId: owner,
      occurredAt,
    });
    const second = await makeLogEntry("firearm", fa.id, {
      actorId: owner,
      occurredAt,
    });

    const entries = await listLogForParent(owner, "firearm", fa.id);
    expect(entries.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  test("covers R4: the service module exports no update/delete function", () => {
    expect("updateLogEntry" in service).toBe(false);
    expect("deleteLogEntry" in service).toBe(false);
  });

  test("covers R6/FK SET NULL: deleting a grantee who authored an entry (an admin single-user delete) does not block on the log, and the owner's audit entry survives with actorId null", async () => {
    // Dedicated users (not the shared beforeAll fixtures): this test deletes
    // one of them mid-run, which must not disturb any other test's fixtures.
    const isolatedOwner = await createUser("logIsolatedOwner");
    const isolatedGrantee = await createUser("logIsolatedGrantee");
    try {
      const fa = await makeFirearm(isolatedOwner);
      await createGrant(db, {
        actorId: isolatedOwner,
        granteeId: isolatedGrantee,
        parentType: "firearm",
        parentId: fa.id,
        permission: "edit",
      });
      const created = await createLogEntry(isolatedGrantee, {
        parentType: "firearm",
        parentId: fa.id,
        eventType: "inventoried",
        occurredAt: "2026-01-01T00:00:00.000Z",
      });
      expect(created.actorId).toBe(isolatedGrantee);

      // Mirrors an admin deleting a single user account (app/(admin)/users/actions.ts):
      // only the grantee is removed, not the owner.
      await deleteUsers(isolatedGrantee);

      const entries = await listLogForParent(isolatedOwner, "firearm", fa.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(created.id);
      expect(entries[0].actorId).toBeNull();
    } finally {
      await deleteUsers(isolatedOwner);
    }
  });
});

/**
 * Ammo reconciliation (#100, plan U2): the single write path also corrects
 * the lot, the on-record quantity is snapshotted under a row lock, and the
 * newest-dated count owns the quantity (KTD2, KTD3, KTD5).
 */
describe("ammo reconciliation (#100 U2)", () => {
  let owner = "";
  let editor = "";
  let viewer = "";
  let stranger = "";

  beforeAll(async () => {
    owner = await createUser("reconOwner");
    editor = await createUser("reconEditor");
    viewer = await createUser("reconViewer");
    stranger = await createUser("reconStranger");
  });
  afterAll(async () => {
    await deleteUsers(owner, editor, viewer, stranger);
  });

  async function quantityOf(id: string): Promise<number> {
    const [row] = await db.select().from(ammo).where(eq(ammo.id, id));
    return row.quantityRounds;
  }

  test("covers AE1: reconciling 500 -> 480 corrects the lot and stores both counts", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 500 });
    const entry = await reconcileAmmo(owner, lot.id, {
      countedRounds: 480,
      occurredAt: "2026-02-01T00:00:00.000Z",
    });
    expect(entry.parentType).toBe("ammo");
    expect(entry.eventType).toBe("inventoried");
    expect(entry.countedRounds).toBe(480);
    expect(entry.recordedRounds).toBe(500);
    expect(entry.actorId).toBe(owner);
    expect(await quantityOf(lot.id)).toBe(480);
  });

  test("covers AE2: a count equal to the quantity appends an entry and leaves the quantity", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 100 });
    const before = await getAmmo(owner, lot.id);
    const entry = await reconcileAmmo(owner, lot.id, { countedRounds: 100 });
    expect(entry.countedRounds).toBe(100);
    expect(entry.recordedRounds).toBe(100);
    expect(await quantityOf(lot.id)).toBe(100);
    const after = await getAmmo(owner, lot.id);
    expect(after.ammo.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.ammo.updatedAt.getTime(),
    );
  });

  test("covers AE3: the snapshot is the quantity at write time, not the previous count", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 120 });
    await reconcileAmmo(owner, lot.id, {
      countedRounds: 100,
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    await updateAmmo(owner, lot.id, {
      caliber: lot.caliber,
      grain: lot.grain,
      quantityRounds: 80,
      lowStockThreshold: lot.lowStockThreshold,
    });
    const second = await reconcileAmmo(owner, lot.id, {
      countedRounds: 75,
      occurredAt: "2026-01-02T00:00:00.000Z",
    });
    expect(second.recordedRounds).toBe(80);
    expect((second.countedRounds ?? 0) - (second.recordedRounds ?? 0)).toBe(-5);
    expect(await quantityOf(lot.id)).toBe(75);
  });

  test("covers AE9: a count dated before a newer one is recorded but not applied", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 350 });
    const today = new Date();
    await reconcileAmmo(owner, lot.id, {
      countedRounds: 300,
      occurredAt: today,
    });
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const older = await reconcileAmmo(owner, lot.id, {
      countedRounds: 320,
      occurredAt: lastWeek,
    });
    expect(older.countedRounds).toBe(320);
    expect(older.recordedRounds).toBe(300);
    expect(await quantityOf(lot.id)).toBe(300);
    const entries = await listLogForParent(owner, "ammo", lot.id);
    expect(entries.map((e) => e.countedRounds)).toEqual([300, 320]);
  });

  test("covers AE11: a back-dated count with nothing newer sets the quantity", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 300 });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await reconcileAmmo(owner, lot.id, {
      countedRounds: 280,
      occurredAt: yesterday,
    });
    expect(await quantityOf(lot.id)).toBe(280);
  });

  test("a count of 0 is accepted and the lot reads 0", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 5 });
    await reconcileAmmo(owner, lot.id, { countedRounds: 0 });
    expect(await quantityOf(lot.id)).toBe(0);
  });

  test("covers AE6/R8: an edit grantee reconciles and is attributed", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 50 });
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "ammo",
      parentId: lot.id,
      permission: "edit",
    });
    const entry = await reconcileAmmo(editor, lot.id, { countedRounds: 40 });
    expect(entry.actorId).toBe(editor);
    expect(await quantityOf(lot.id)).toBe(40);
    expect(await listLogForParent(owner, "ammo", lot.id)).toHaveLength(1);
  });

  test("covers AE5/R8/R9: a view grantee can list but reconcile is rejected with no partial write", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 50 });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "ammo",
      parentId: lot.id,
      permission: "view",
    });
    await expect(
      reconcileAmmo(viewer, lot.id, { countedRounds: 10 }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(await quantityOf(lot.id)).toBe(50);
    expect(await listLogForParent(viewer, "ammo", lot.id)).toHaveLength(0);
  });

  test("a stranger gets NotFoundError on reconcile and list", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 50 });
    await expect(
      reconcileAmmo(stranger, lot.id, { countedRounds: 10 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listLogForParent(stranger, "ammo", lot.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("markInventoried on an ammo lot fails validation and writes nothing (KTD3)", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 50 });
    let codes: string[] = [];
    try {
      await markInventoried(owner, "ammo", lot.id);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      codes = (error as ValidationError).codes;
    }
    expect(codes).toEqual(["countedRoundsRequired"]);
    expect(await listLogForParent(owner, "ammo", lot.id)).toHaveLength(0);
    expect(await quantityOf(lot.id)).toBe(50);
  });

  test("covers AE10: a firearm entry carrying countedRounds fails validation", async () => {
    const fa = await makeFirearm(owner);
    await expect(
      createLogEntry(owner, {
        parentType: "firearm",
        parentId: fa.id,
        eventType: "inventoried",
        occurredAt: "2026-01-01T00:00:00.000Z",
        countedRounds: 3,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("covers R12/R13: notes are stored unchanged; an omitted note is empty", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 50 });
    const withNote = await reconcileAmmo(owner, lot.id, {
      countedRounds: 49,
      notes: "Box damaged",
    });
    expect(withNote.notes).toBe("Box damaged");
    const withoutNote = await reconcileAmmo(owner, lot.id, {
      countedRounds: 48,
    });
    expect(withoutNote.notes).toBe("");
  });

  test("covers AE7/R10: deleting the lot removes its entries and hides the history", async () => {
    const lot = await makeAmmo(owner, { quantityRounds: 50 });
    await reconcileAmmo(owner, lot.id, { countedRounds: 45 });
    await deleteAmmo(owner, lot.id);
    const rows = await db
      .select()
      .from(inventoryLog)
      .where(eq(inventoryLog.parentId, lot.id));
    expect(rows).toHaveLength(0);
    await expect(
      listLogForParent(owner, "ammo", lot.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
