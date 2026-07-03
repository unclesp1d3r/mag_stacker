import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { firearm, rangeSession } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import { expectRejects } from "@/src/test-support/assertions";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeRangeSession,
} from "@/src/test-support/factories";
import {
  createRangeSession,
  deleteRangeSession,
  lifetimeRoundTotals,
  listSessionsForFirearm,
  updateRangeSession,
} from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("range-session service (#11)", () => {
  let owner = "";
  let editor = "";
  let viewer = "";
  let stranger = "";

  beforeAll(async () => {
    owner = await createUser("rsOwner");
    editor = await createUser("rsEditor");
    viewer = await createUser("rsViewer");
    stranger = await createUser("rsStranger");
  });
  afterAll(async () => {
    await deleteUsers(owner, editor, viewer, stranger);
  });

  test("covers AE1: derived total sums sessions and survives delete", async () => {
    const fa = await makeFirearm(owner);
    await createRangeSession(owner, {
      firearmId: fa.id,
      date: "2026-02-01",
      roundsFired: 50,
    });
    const second = await createRangeSession(owner, {
      firearmId: fa.id,
      date: "2026-02-02",
      roundsFired: 30,
    });

    let totals = await lifetimeRoundTotals(owner);
    expect(totals.get(fa.id)).toBe(80);
    // The map value is a JS number, not a bigint string from the pg driver.
    expect(typeof totals.get(fa.id)).toBe("number");

    await deleteRangeSession(owner, second.id);
    totals = await lifetimeRoundTotals(owner);
    expect(totals.get(fa.id)).toBe(50);
  });

  test("covers R6: a firearm with no sessions is absent from the totals map", async () => {
    const fa = await makeFirearm(owner);
    const totals = await lifetimeRoundTotals(owner);
    expect(totals.has(fa.id)).toBe(false);
  });

  test("lists sessions newest-first; not-found for an unseen firearm", async () => {
    const fa = await makeFirearm(owner);
    await makeRangeSession(fa.id, { date: "2026-01-01", roundsFired: 10 });
    await makeRangeSession(fa.id, { date: "2026-03-01", roundsFired: 20 });
    const sessions = await listSessionsForFirearm(owner, fa.id);
    expect(sessions.map((s) => s.date)).toEqual(["2026-03-01", "2026-01-01"]);

    await expect(
      listSessionsForFirearm(stranger, fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("invalid input throws ValidationError and writes no row", async () => {
    const fa = await makeFirearm(owner);
    await expect(
      createRangeSession(owner, {
        firearmId: fa.id,
        date: "",
        roundsFired: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const sessions = await listSessionsForFirearm(owner, fa.id);
    expect(sessions).toHaveLength(0);
  });

  test("covers R3/KTD3: an edit-grantee can create, update, and delete sessions", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    const created = await createRangeSession(editor, {
      firearmId: fa.id,
      date: "2026-04-01",
      roundsFired: 15,
    });
    const updated = await updateRangeSession(editor, created.id, {
      date: "2026-04-01",
      roundsFired: 25,
    });
    expect(updated.roundsFired).toBe(25);
    await deleteRangeSession(editor, created.id);
    expect(await listSessionsForFirearm(editor, fa.id)).toHaveLength(0);
  });

  test("covers AE2: a view-grantee can list but cannot create/update/delete", async () => {
    const fa = await makeFirearm(owner);
    const session = await makeRangeSession(fa.id, { roundsFired: 40 });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    // Read is allowed.
    expect(await listSessionsForFirearm(viewer, fa.id)).toHaveLength(1);
    // Writes are forbidden (read-only access).
    await expect(
      createRangeSession(viewer, {
        firearmId: fa.id,
        date: "2026-05-01",
        roundsFired: 10,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(
      updateRangeSession(viewer, session.id, {
        date: "2026-05-01",
        roundsFired: 99,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(deleteRangeSession(viewer, session.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  test("no-visibility user gets not-found on create/update/delete (existence hidden)", async () => {
    const fa = await makeFirearm(owner);
    const session = await makeRangeSession(fa.id, { roundsFired: 5 });
    await expect(
      createRangeSession(stranger, {
        firearmId: fa.id,
        date: "2026-06-01",
        roundsFired: 5,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateRangeSession(stranger, session.id, {
        date: "2026-06-01",
        roundsFired: 5,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deleteRangeSession(stranger, session.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("update with invalid input on an invisible session is not-found, not a validation leak", async () => {
    const fa = await makeFirearm(owner);
    const session = await makeRangeSession(fa.id, { roundsFired: 5 });
    // Invalid input must NOT reach validation before authorization — a stranger
    // probing with roundsFired: 0 still gets NotFound, never ValidationError.
    await expect(
      updateRangeSession(stranger, session.id, {
        date: "2026-06-01",
        roundsFired: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("covers KTD7: visibleFirearmPermissions reports owner/edit/view, omits unseen", async () => {
    const ownedFa = await makeFirearm(owner);
    const editFa = await makeFirearm(owner);
    const viewFa = await makeFirearm(owner);
    const hiddenFa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: editFa.id,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: viewFa.id,
      permission: "view",
    });
    const ownFa = await makeFirearm(editor);

    const perms = await visibleFirearmPermissions(db, editor);
    expect(perms.get(ownFa.id)).toBe("owner");
    expect(perms.get(editFa.id)).toBe("edit");
    expect(perms.get(viewFa.id)).toBe("view");
    expect(perms.has(hiddenFa.id)).toBe(false);
    expect(perms.has(ownedFa.id)).toBe(false);
  });

  test("covers U1: deleting the firearm cascades its sessions", async () => {
    const fa = await makeFirearm(owner);
    await makeRangeSession(fa.id, { roundsFired: 10 });
    await db.delete(firearm).where(eq(firearm.id, fa.id));
    const rows = await db
      .select()
      .from(rangeSession)
      .where(eq(rangeSession.firearmId, fa.id));
    expect(rows).toHaveLength(0);
  });

  test("covers U1: a raw insert with rounds_fired = 0 is rejected by the check", async () => {
    const fa = await makeFirearm(owner);
    await expectRejects(() =>
      db
        .insert(rangeSession)
        .values({ firearmId: fa.id, date: "2026-01-01", roundsFired: 0 }),
    );
  });
});
