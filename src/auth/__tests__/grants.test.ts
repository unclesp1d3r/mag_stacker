import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import { NotAuthorizedError } from "../errors";
import { createGrant, listGrantsForItem, revokeGrant } from "../grants";
import { resolvePermission } from "../visibility";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("grants (U4)", () => {
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

  test("covers AE4: an edit grant authorizes read and modify; view grants read only", async () => {
    const fa = await makeFirearm(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    expect(await resolvePermission(db, userB, "firearm", fa.id)).toBe("edit");

    // Re-granting downgrades to view (upsert).
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    expect(await resolvePermission(db, userB, "firearm", fa.id)).toBe("view");
  });

  test("covers AE5: revocation immediately removes the grantee's access", async () => {
    const fa = await makeFirearm(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    expect(await resolvePermission(db, userB, "firearm", fa.id)).toBe("edit");

    await revokeGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
    });
    expect(await resolvePermission(db, userB, "firearm", fa.id)).toBeNull();
  });

  test("only the owner may share — an edit-grantee cannot re-share (R12)", async () => {
    const fa = await makeFirearm(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    // B (edit-grantee) tries to share A's firearm with C — denied.
    await expect(
      createGrant(db, {
        actorId: userB,
        granteeId: userC,
        parentType: "firearm",
        parentId: fa.id,
        permission: "view",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(await resolvePermission(db, userC, "firearm", fa.id)).toBeNull();
  });

  test("sharing one item exposes no other record the owner holds (R12)", async () => {
    const shared = await makeFirearm(userA, { name: "shared" });
    const secret = await makeFirearm(userA, { name: "secret" });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: shared.id,
      permission: "view",
    });
    expect(await resolvePermission(db, userB, "firearm", shared.id)).toBe(
      "view",
    );
    expect(await resolvePermission(db, userB, "firearm", secret.id)).toBeNull();
  });

  test("listGrantsForItem returns active grants and is owner-only", async () => {
    const fa = await makeFirearm(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
      allowCreateOnBehalf: true,
    });
    const grants = await listGrantsForItem(db, userA, "firearm", fa.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      granteeId: userB,
      permission: "edit",
      allowCreateOnBehalf: true,
    });
    // A non-owner cannot list grants.
    await expect(
      listGrantsForItem(db, userB, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("allow_create_on_behalf is forced false for view grants (KTD-5)", async () => {
    const fa = await makeFirearm(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
      allowCreateOnBehalf: true, // ignored for view
    });
    const grants = await listGrantsForItem(db, userA, "firearm", fa.id);
    expect(grants[0].allowCreateOnBehalf).toBe(false);
  });
});
