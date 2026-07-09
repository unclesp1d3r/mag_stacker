import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { accessory } from "@/src/db/schema";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import {
  authorizeMount,
  listVisibleAccessoryIds,
  resolveAccessoryPermission,
} from "../accessory-visibility";
import { NotAuthorizedError } from "../errors";
import { createGrant } from "../grants";

const live = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * Asserts a thenable rejects. Drizzle/pg query builders are thenables, not
 * Promises, so bun's `.rejects` matcher is unreliable on them — use this
 * helper for direct DB calls (see memory: bun-test-rejects-drizzle-thenable).
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

/**
 * Insert an accessory row directly. Not added to test-support/factories.ts —
 * that file belongs to a different unit (U4). Mirrors that factory's shape.
 */
async function makeAccessory(
  ownerId: string,
  overrides: Partial<typeof accessory.$inferInsert> = {},
): Promise<typeof accessory.$inferSelect> {
  const [row] = await db
    .insert(accessory)
    .values({
      ownerId,
      category: "Optic",
      brand: "Test Accessory Co",
      ...overrides,
    })
    .returning();
  return row;
}

live("accessory visibility & mount authorization (U3)", () => {
  let owner = "";
  let outsider = "";

  beforeAll(async () => {
    owner = await createUser("AccOwner");
    outsider = await createUser("AccOutsider");
  });
  afterAll(async () => {
    await deleteUsers(owner, outsider);
  });

  test("listVisibleAccessoryIds includes both mounted and unmounted accessories owned by the user", async () => {
    const fa = await makeFirearm(owner, { name: "Owner's FA" });
    const mounted = await makeAccessory(owner, { currentFirearmId: fa.id });
    const unmounted = await makeAccessory(owner);

    const visible = await listVisibleAccessoryIds(db, owner);
    expect(visible.has(mounted.id)).toBe(true);
    expect(visible.has(unmounted.id)).toBe(true);

    const visibleToOutsider = await listVisibleAccessoryIds(db, outsider);
    expect(visibleToOutsider.has(mounted.id)).toBe(false);
    expect(visibleToOutsider.has(unmounted.id)).toBe(false);
  });

  test("a firearm view-grantee resolves 'view' on a mounted accessory but cannot see an unmounted one owned by someone else", async () => {
    const grantee = await createUser("AccViewGrantee");
    const fa = await makeFirearm(owner, { name: "Viewable FA" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const mounted = await makeAccessory(owner, { currentFirearmId: fa.id });
    const unmounted = await makeAccessory(owner, {
      brand: "Unmounted, unowned by grantee",
    });

    expect(await resolveAccessoryPermission(db, grantee, mounted.id)).toBe(
      "view",
    );
    expect(
      await resolveAccessoryPermission(db, grantee, unmounted.id),
    ).toBeNull();

    const visible = await listVisibleAccessoryIds(db, grantee);
    expect(visible.has(mounted.id)).toBe(true);
    expect(visible.has(unmounted.id)).toBe(false);

    await deleteUsers(grantee);
  });

  test("a firearm edit-grantee resolves 'edit' on its mounted accessories", async () => {
    const grantee = await createUser("AccEditGrantee");
    const fa = await makeFirearm(owner, { name: "Editable FA" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    const mounted = await makeAccessory(owner, { currentFirearmId: fa.id });

    expect(await resolveAccessoryPermission(db, grantee, mounted.id)).toBe(
      "edit",
    );

    await deleteUsers(grantee);
  });

  test("resolveAccessoryPermission returns null for a nonexistent accessory", async () => {
    expect(
      await resolveAccessoryPermission(
        db,
        owner,
        "00000000-0000-0000-0000-000000000000",
      ),
    ).toBeNull();
  });

  test("authorizeMount: mounting onto a firearm the actor can't edit throws NotAuthorizedError", async () => {
    const acc = await makeAccessory(owner);
    const otherOwnersFirearm = await makeFirearm(outsider, {
      name: "Outsider's FA",
    });
    // View-only grant: the actor can SEE the firearm (so it isn't "not-found")
    // but can't edit it — a genuine can't-edit denial, distinct from a
    // firearm the actor has no relation to at all (covered separately below).
    await createGrant(db, {
      actorId: outsider,
      granteeId: owner,
      parentType: "firearm",
      parentId: otherOwnersFirearm.id,
      permission: "view",
    });

    await expect(
      authorizeMount(db, owner, acc.id, otherOwnersFirearm.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("authorizeMount: mounting onto a firearm the actor has no relation to at all is not-found (existence-hiding)", async () => {
    const acc = await makeAccessory(owner);
    const invisibleFirearm = await makeFirearm(outsider, {
      name: "Invisible-to-actor FA",
    });

    await expectRejects(() =>
      authorizeMount(db, owner, acc.id, invisibleFirearm.id),
    );
  });

  test("authorizeMount: mounting an accessory onto a firearm owned by a different user than the accessory owner throws even if the actor can edit both", async () => {
    const grantee = await createUser("AccCrossTenantActor");
    const acc = await makeAccessory(owner);
    const otherOwnersFirearm = await makeFirearm(outsider, {
      name: "Cross-tenant target FA",
    });

    // Grant the actor edit on the accessory's owner-side (via mounting it on
    // a firearm they own that the actor has edit on) and edit on the target
    // firearm — the actor CAN edit both sides, but the owners still differ.
    const ownersFirearm = await makeFirearm(owner, {
      name: "Owner's mount FA",
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: ownersFirearm.id,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: outsider,
      granteeId: grantee,
      parentType: "firearm",
      parentId: otherOwnersFirearm.id,
      permission: "edit",
    });
    // Mount the accessory on the owner's firearm so the actor's edit grant
    // resolves through resolveAccessoryPermission.
    await db
      .update(accessory)
      .set({ currentFirearmId: ownersFirearm.id })
      .where(eq(accessory.id, acc.id));

    await expect(
      authorizeMount(db, grantee, acc.id, otherOwnersFirearm.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    await deleteUsers(grantee);
  });

  test("authorizeMount: a valid same-owner mount succeeds", async () => {
    const acc = await makeAccessory(owner);
    const targetFirearm = await makeFirearm(owner, {
      name: "Same-owner target FA",
    });

    await expect(
      authorizeMount(db, owner, acc.id, targetFirearm.id),
    ).resolves.toBeUndefined();
  });

  test("authorizeMount: unmounting (null target) requires only edit on the accessory", async () => {
    const fa = await makeFirearm(owner, { name: "Unmount source FA" });
    const acc = await makeAccessory(owner, { currentFirearmId: fa.id });

    await expect(
      authorizeMount(db, owner, acc.id, null),
    ).resolves.toBeUndefined();
  });

  test("authorizeMount: outsider with no permission on the accessory is not-found", async () => {
    const acc = await makeAccessory(owner);
    await expectRejects(() => authorizeMount(db, outsider, acc.id, null));
  });

  test("authorizeMount: a firearm view-grantee cannot mount/reassign/unmount its mounted accessory (NotAuthorizedError)", async () => {
    const viewer = await createUser("AccViewGranteeMount");
    const fa = await makeFirearm(owner, { name: "View-only FA for mount" });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const acc = await makeAccessory(owner, { currentFirearmId: fa.id });

    await expect(
      authorizeMount(db, viewer, acc.id, null),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    await deleteUsers(viewer);
  });
});
