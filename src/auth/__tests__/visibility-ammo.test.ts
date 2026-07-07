import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { ammo } from "@/src/db/schema";
import {
  createUser,
  deleteUsers,
  makeAmmo,
} from "@/src/test-support/factories";
import { authorizeAndDeleteParent, authorizeUpdate } from "../authorize";
import { NotAuthorizedError, NotFoundError } from "../errors";
import { createGrant } from "../grants";
import { getVisibleIds, resolvePermission } from "../visibility";

const live = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * Asserts a thenable rejects. Drizzle/pg query builders are thenables, not
 * Promises, so bun's `.rejects` matcher is unreliable on them — use this helper
 * for direct DB calls (see memory: bun-test-rejects-drizzle-thenable).
 */
async function expectRejects(fn: () => Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}

live("ammo as a ParentType (U2, ammo plan)", () => {
  let userA = "";
  let userB = "";
  let userC = "";

  beforeAll(async () => {
    userA = await createUser("AmmoA");
    userB = await createUser("AmmoB");
    userC = await createUser("AmmoC");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB, userC);
  });

  test("getVisibleIds(db, owner, 'ammo') returns owned ammo IDs", async () => {
    const lot = await makeAmmo(userA);
    const visible = await getVisibleIds(db, userA, "ammo");
    expect(visible.has(lot.id)).toBe(true);
    const visibleToB = await getVisibleIds(db, userB, "ammo");
    expect(visibleToB.has(lot.id)).toBe(false);
  });

  test("a view-granted ammo lot appears in the grantee's visible set; a non-granted lot does not", async () => {
    const shared = await makeAmmo(userA, { brand: "Shared Lot" });
    const unshared = await makeAmmo(userA, { brand: "Unshared Lot" });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "ammo",
      parentId: shared.id,
      permission: "view",
    });
    const visible = await getVisibleIds(db, userB, "ammo");
    expect(visible.has(shared.id)).toBe(true);
    expect(visible.has(unshared.id)).toBe(false);
  });

  test("resolvePermission returns owner/edit/view/null appropriately (AE1)", async () => {
    const lot = await makeAmmo(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "ammo",
      parentId: lot.id,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: userA,
      granteeId: userC,
      parentType: "ammo",
      parentId: lot.id,
      permission: "view",
    });
    const outsider = await createUser("AmmoOutsider");

    expect(await resolvePermission(db, userA, "ammo", lot.id)).toBe("owner");
    expect(await resolvePermission(db, userB, "ammo", lot.id)).toBe("edit");
    expect(await resolvePermission(db, userC, "ammo", lot.id)).toBe("view");
    expect(await resolvePermission(db, outsider, "ammo", lot.id)).toBeNull();

    await deleteUsers(outsider);
  });

  test("authorizeUpdate: owner and edit-grantee pass; view-grantee is forbidden; outsider is not-found", async () => {
    const lot = await makeAmmo(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "ammo",
      parentId: lot.id,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: userA,
      granteeId: userC,
      parentType: "ammo",
      parentId: lot.id,
      permission: "view",
    });

    await expect(
      authorizeUpdate(db, userA, "ammo", lot.id),
    ).resolves.toBeUndefined();
    await expect(
      authorizeUpdate(db, userB, "ammo", lot.id),
    ).resolves.toBeUndefined();
    await expect(
      authorizeUpdate(db, userC, "ammo", lot.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    const outsider = await createUser("AmmoOutsider2");
    await expect(
      authorizeUpdate(db, outsider, "ammo", lot.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await deleteUsers(outsider);
  });

  test("authorizeAndDeleteParent deletes the owner's lot; a view-grantee's actorId throws", async () => {
    const lot = await makeAmmo(userA);
    await createGrant(db, {
      actorId: userA,
      granteeId: userC,
      parentType: "ammo",
      parentId: lot.id,
      permission: "view",
    });

    await expectRejects(() => authorizeAndDeleteParent(userC, "ammo", lot.id));
    const stillThere = await db.select().from(ammo).where(eq(ammo.id, lot.id));
    expect(stillThere).toHaveLength(1);

    await authorizeAndDeleteParent(userA, "ammo", lot.id);
    const gone = await db.select().from(ammo).where(eq(ammo.id, lot.id));
    expect(gone).toHaveLength(0);
  });
});
