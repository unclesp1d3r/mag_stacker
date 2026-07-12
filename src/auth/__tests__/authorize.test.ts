import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { firearm } from "@/src/db/schema";
import {
  createUser,
  deleteUsers,
  linkMagazineFirearm,
  makeFirearm,
  makeMagazine,
} from "@/src/test-support/factories";
import {
  authorizeAndDeleteParent,
  authorizeDelete,
  authorizeOwnerOnlyRead,
  authorizeUpdate,
  resolveCreateOwner,
} from "../authorize";
import { NotAuthorizedError, NotFoundError } from "../errors";
import { createGrant } from "../grants";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("authorize write-decision gate (U4)", () => {
  let userA = "";
  let userB = "";
  let userC = "";

  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
    userC = await createUser("C");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB, userC);
  });

  // --- update authorization ---
  test("owner and edit-grantee may update; view-grantee is forbidden; outsider is not-found (R14/R70)", async () => {
    const fa = await makeFirearm(userA);
    await expect(
      authorizeUpdate(db, userA, "firearm", fa.id),
    ).resolves.toBeUndefined();

    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    await expect(
      authorizeUpdate(db, userB, "firearm", fa.id),
    ).resolves.toBeUndefined();

    await createGrant(db, {
      actorId: userA,
      granteeId: userC,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await expect(
      authorizeUpdate(db, userC, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    // An unrelated user: not-found (existence never revealed).
    const outsider = await createUser("out");
    await expect(
      authorizeUpdate(db, outsider, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await deleteUsers(outsider);
  });

  // --- delete authorization (KTD-3) ---
  test("edit-grantee delete is denied; owner delete succeeds and cascades grants (KTD-3, R17b)", async () => {
    const fa = await makeFirearm(userA);
    const mag = await makeMagazine(userA);
    await linkMagazineFirearm(mag.id, fa.id);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });

    // Edit-grantee cannot delete.
    await expect(
      authorizeDelete(db, userB, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    // Owner deletes: row gone, grant cascaded, magazine survives (R35).
    await authorizeAndDeleteParent(userA, "firearm", fa.id);
    const rows = await db.select().from(firearm).where(eq(firearm.id, fa.id));
    expect(rows).toHaveLength(0);
    // The edit grant for B is gone (resolvePermission via getVisibleIds).
    const stillVisible = await db.query.grant?.findFirst?.({
      where: (g, { eq: e, and: a }) =>
        a(e(g.parentId, fa.id), e(g.parentType, "firearm")),
    });
    expect(stillVisible).toBeFalsy();
  });

  test("delete of a record outside the visible set is not-found and changes no row (R70)", async () => {
    const fa = await makeFirearm(userA);
    await expect(
      authorizeAndDeleteParent(userB, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    const rows = await db.select().from(firearm).where(eq(firearm.id, fa.id));
    expect(rows).toHaveLength(1); // untouched
  });

  // --- owner-only read authorization (U4, KTD1) ---
  test("owner-only read: owner passes; edit- and view-grantees forbidden; outsider not-found (R8/R9)", async () => {
    const fa = await makeFirearm(userA);
    await expect(
      authorizeOwnerOnlyRead(db, userA, "firearm", fa.id),
    ).resolves.toBeUndefined();

    // Edit-grantee: forbidden (documents are owner-only, unlike photos).
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    await expect(
      authorizeOwnerOnlyRead(db, userB, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    // View-grantee: forbidden.
    await createGrant(db, {
      actorId: userA,
      granteeId: userC,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await expect(
      authorizeOwnerOnlyRead(db, userC, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    // Stranger / unseen firearm: not-found (existence never revealed).
    const outsider = await createUser("read-out");
    await expect(
      authorizeOwnerOnlyRead(db, outsider, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await deleteUsers(outsider);
  });

  // --- create-on-behalf (KTD-5) ---
  test("create defaults owner to the actor", async () => {
    expect(await resolveCreateOwner(db, userA, undefined)).toBe(userA);
    expect(await resolveCreateOwner(db, userA, userA)).toBe(userA);
  });

  test("create-on-behalf requires an active edit grant from the target with the flag set (KTD-5)", async () => {
    // A grants B an edit grant WITH create-on-behalf on some item.
    const item = await makeFirearm(userA, { name: "behalf-enabling" });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: item.id,
      permission: "edit",
      allowCreateOnBehalf: true,
    });
    // B may now create records owned by A.
    expect(await resolveCreateOwner(db, userB, userA)).toBe(userA);

    // C has only a modify-only edit grant (no flag) — denied.
    const item2 = await makeFirearm(userA, { name: "modify-only" });
    await createGrant(db, {
      actorId: userA,
      granteeId: userC,
      parentType: "firearm",
      parentId: item2.id,
      permission: "edit",
      allowCreateOnBehalf: false,
    });
    await expect(resolveCreateOwner(db, userC, userA)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );

    // An actor with no grant from A is denied.
    const stranger = await createUser("stranger");
    await expect(
      resolveCreateOwner(db, stranger, userA),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await deleteUsers(stranger);
  });
});
