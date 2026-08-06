import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { accessory, grant } from "@/src/db/schema";
import {
  createAccessory,
  deleteAccessory,
  getAccessory,
  listAccessories,
  mountAccessory,
  updateAccessory,
} from "@/src/domain/accessories/service";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import {
  listVisibleAccessoryIds,
  resolveAccessoryPermission,
} from "../accessory-visibility";
import { NotAuthorizedError, NotFoundError } from "../errors";
import { createGrant, revokeGrant } from "../grants";
import { getVisibleIds } from "../visibility";

/**
 * Independent accessory sharing (#23 U4, R7–R10).
 *
 * This unit REVERSES a decision #8 shipped deliberately ("an accessory carries
 * no grants of its own; it inherits visibility from the firearm it is mounted
 * to"). The reversal is additive, not a replacement: an accessory now has its
 * own grant family AND keeps the inherited path, so the visible set is
 *
 *     owned ∪ directly-granted ∪ mounted-on-a-visible-firearm
 *
 * and the effective permission is the STRONGEST any path grants.
 *
 * The inherited path is retained specifically so #8's shipped behavior does
 * not regress — a user who can see a mounted accessory today must still see it
 * after this change. That is AE3, and it is the test most worth keeping.
 */

describe("accessory sharing — direct grants (R7)", () => {
  let owner: string;
  let grantee: string;
  let stranger: string;

  beforeAll(async () => {
    owner = await createUser("ShareOwner");
    grantee = await createUser("ShareGrantee");
    stranger = await createUser("ShareStranger");
  });

  afterAll(async () => {
    await deleteUsers(owner, grantee, stranger);
  });

  test("an UNMOUNTED accessory becomes visible through a direct view grant", async () => {
    // Under #8 this was impossible: an unmounted accessory was owner-only,
    // which is exactly backwards for a suppressor sitting in the safe.
    const acc = await createAccessory(owner, { type: "suppressor" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });

    expect(await resolveAccessoryPermission(db, grantee, acc.id)).toBe("view");
    const visible = await listVisibleAccessoryIds(db, grantee);
    expect(visible.has(acc.id)).toBe(true);
  });

  test("a view grantee can read it but not mutate it (403, not 404)", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });

    const fetched = await getAccessory(grantee, acc.id);
    expect(fetched.permission).toBe("view");

    await expect(
      updateAccessory(grantee, acc.id, { type: "optic" }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(deleteAccessory(grantee, acc.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  test("an edit grantee can mutate it", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "edit",
    });

    const updated = await updateAccessory(grantee, acc.id, {
      type: "suppressor",
      notes: "edited by grantee",
    });
    expect(updated.notes).toBe("edited by grantee");
  });

  test("a stranger sees nothing and gets not-found", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    expect(await resolveAccessoryPermission(db, stranger, acc.id)).toBeNull();
    await expect(getAccessory(stranger, acc.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("the shared accessory appears in the grantee's own list", async () => {
    const acc = await createAccessory(owner, {
      type: "suppressor",
      serialNumber: "LISTED-VIA-GRANT",
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });

    const listed = await listAccessories(grantee);
    expect(listed.map((a) => a.id)).toContain(acc.id);
  });

  test("revoking removes it from the grantee's view again", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });
    expect(await resolveAccessoryPermission(db, grantee, acc.id)).toBe("view");

    await revokeGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
    });
    expect(await resolveAccessoryPermission(db, grantee, acc.id)).toBeNull();
  });

  test("getVisibleIds handles 'accessory' as a first-class parent type", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    const owned = await getVisibleIds(db, owner, "accessory");
    expect(owned.has(acc.id)).toBe(true);
  });
});

describe("accessory sharing — the inherited path still works (R8/AE3)", () => {
  let owner: string;
  let firearmViewer: string;
  let host: string;

  beforeAll(async () => {
    owner = await createUser("InheritOwner");
    firearmViewer = await createUser("InheritViewer");
    host = (await makeFirearm(owner, { name: "Inherit Host" })).id;
    await createGrant(db, {
      actorId: owner,
      granteeId: firearmViewer,
      parentType: "firearm",
      parentId: host,
      permission: "view",
    });
  });

  afterAll(async () => {
    await deleteUsers(owner, firearmViewer);
  });

  test("AE3: an accessory mounted on a shared firearm stays visible with NO direct grant", async () => {
    // The no-regression case. If this ever fails, #23 silently removed access
    // that #8's users already had.
    const acc = await createAccessory(owner, {
      type: "suppressor",
      firearmId: host,
    });

    const direct = await db
      .select()
      .from(grant)
      .where(eq(grant.parentId, acc.id));
    expect(direct).toEqual([]); // genuinely no accessory grant

    expect(await resolveAccessoryPermission(db, firearmViewer, acc.id)).toBe(
      "view",
    );
    const visible = await listVisibleAccessoryIds(db, firearmViewer);
    expect(visible.has(acc.id)).toBe(true);
  });

  test("unmounting removes the inherited path", async () => {
    const acc = await createAccessory(owner, {
      type: "suppressor",
      firearmId: host,
    });
    expect(await resolveAccessoryPermission(db, firearmViewer, acc.id)).toBe(
      "view",
    );

    await mountAccessory(owner, acc.id, null);
    expect(
      await resolveAccessoryPermission(db, firearmViewer, acc.id),
    ).toBeNull();
  });

  test("unmounting leaves a DIRECT grant intact", async () => {
    const acc = await createAccessory(owner, {
      type: "suppressor",
      firearmId: host,
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: firearmViewer,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });

    await mountAccessory(owner, acc.id, null);
    // The inherited path is gone; the direct grant is not.
    expect(await resolveAccessoryPermission(db, firearmViewer, acc.id)).toBe(
      "view",
    );
  });
});

describe("accessory sharing — strongest path wins (R9)", () => {
  let owner: string;
  let dualPath: string;
  let host: string;

  beforeAll(async () => {
    owner = await createUser("StrongestOwner");
    dualPath = await createUser("StrongestGrantee");
    host = (await makeFirearm(owner, { name: "Strongest Host" })).id;
  });

  afterAll(async () => {
    await deleteUsers(owner, dualPath);
  });

  test("view direct + edit inherited resolves to edit", async () => {
    await createGrant(db, {
      actorId: owner,
      granteeId: dualPath,
      parentType: "firearm",
      parentId: host,
      permission: "edit",
    });
    const acc = await createAccessory(owner, {
      type: "suppressor",
      firearmId: host,
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: dualPath,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });

    expect(await resolveAccessoryPermission(db, dualPath, acc.id)).toBe("edit");
  });

  test("edit direct + view inherited resolves to edit", async () => {
    const viewOnlyHost = (await makeFirearm(owner, { name: "View Host" })).id;
    const viewer = await createUser("StrongestViewGrantee");
    try {
      await createGrant(db, {
        actorId: owner,
        granteeId: viewer,
        parentType: "firearm",
        parentId: viewOnlyHost,
        permission: "view",
      });
      const acc = await createAccessory(owner, {
        type: "suppressor",
        firearmId: viewOnlyHost,
      });
      await createGrant(db, {
        actorId: owner,
        granteeId: viewer,
        parentType: "accessory",
        parentId: acc.id,
        permission: "edit",
      });

      expect(await resolveAccessoryPermission(db, viewer, acc.id)).toBe("edit");
    } finally {
      await deleteUsers(viewer);
    }
  });

  test("ownership beats any grant", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    expect(await resolveAccessoryPermission(db, owner, acc.id)).toBe("owner");
  });
});

describe("accessory sharing — grant lifecycle (R10)", () => {
  let owner: string;
  let grantee: string;

  beforeAll(async () => {
    owner = await createUser("LifecycleOwner");
    grantee = await createUser("LifecycleGrantee");
  });

  afterAll(async () => {
    await deleteUsers(owner, grantee);
  });

  test("deleting the accessory deletes its grant rows (cleanup trigger)", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });

    await deleteAccessory(owner, acc.id);

    const orphans = await db
      .select()
      .from(grant)
      .where(eq(grant.parentId, acc.id));
    expect(orphans).toEqual([]);
  });

  test("deleting the grantee's account removes the grant without touching the accessory", async () => {
    const doomedGrantee = await createUser("DoomedGrantee");
    const acc = await createAccessory(owner, { type: "suppressor" });
    await createGrant(db, {
      actorId: owner,
      granteeId: doomedGrantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "view",
    });

    await deleteUsers(doomedGrantee);

    const orphans = await db
      .select()
      .from(grant)
      .where(eq(grant.parentId, acc.id));
    expect(orphans).toEqual([]);

    const survivor = await db
      .select({ id: accessory.id })
      .from(accessory)
      .where(eq(accessory.id, acc.id));
    expect(survivor).toHaveLength(1);
  });

  test("a non-owner cannot share the accessory onward", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "accessory",
      parentId: acc.id,
      permission: "edit",
    });

    const third = await createUser("ThirdParty");
    try {
      await expect(
        createGrant(db, {
          actorId: grantee,
          granteeId: third,
          parentType: "accessory",
          parentId: acc.id,
          permission: "view",
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    } finally {
      await deleteUsers(third);
    }
  });
});
