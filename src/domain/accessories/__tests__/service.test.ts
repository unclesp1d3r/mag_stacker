import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import {
  createAccessory,
  deleteAccessory,
  getAccessory,
  listAccessories,
  mountAccessory,
  updateAccessory,
} from "../service";

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

describe("accessory service (accessory plan U4)", () => {
  let owner = "";
  let outsider = "";

  beforeAll(async () => {
    owner = await createUser("AccSvcOwner");
    outsider = await createUser("AccSvcOutsider");
  });
  afterAll(async () => {
    await deleteUsers(owner, outsider);
  });

  test("covers invalid input: a blank type throws ValidationError and writes no row", async () => {
    // `type` replaced `category` as the required classification (#23 R1/R3),
    // so this is the same guarantee the #8 blank-category test made: an
    // unclassified accessory is never persisted.
    const before = await listAccessories(owner);
    await expect(
      createAccessory(owner, { type: "", category: "optic" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listAccessories(owner);
    expect(after.length).toBe(before.length);
  });

  test("a type outside the controlled set throws ValidationError and writes no row", async () => {
    const before = await listAccessories(owner);
    await expect(
      createAccessory(owner, { type: "bipod" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listAccessories(owner);
    expect(after.length).toBe(before.length);
  });

  test("a blank category is now accepted and persists as empty (#23 R3)", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    expect(acc.category).toBe("");
    expect(acc.type).toBe("suppressor");
  });

  test("createAccessory persists an unmounted accessory; getAccessory returns it with permission 'owner'", async () => {
    const acc = await createAccessory(owner, {
      type: "optic",
      category: "optic",
      brand: "Trijicon",
    });
    expect(acc.ownerId).toBe(owner);
    expect(acc.currentFirearmId).toBeNull();

    const { accessory: fetched, permission } = await getAccessory(
      owner,
      acc.id,
    );
    expect(fetched.id).toBe(acc.id);
    expect(permission).toBe("owner");
  });

  test("createAccessory with a firearmId persists a mounted accessory", async () => {
    const fa = await makeFirearm(owner, { name: "Mount target FA" });
    const acc = await createAccessory(owner, {
      type: "other",
      category: "sling",
      firearmId: fa.id,
    });
    expect(acc.currentFirearmId).toBe(fa.id);
  });

  test("mountAccessory: moving between two same-owner firearms preserves fields and resets installedDate", async () => {
    const faOne = await makeFirearm(owner, { name: "Source FA" });
    const faTwo = await makeFirearm(owner, { name: "Destination FA" });
    const acc = await createAccessory(owner, {
      type: "optic",
      category: "optic",
      serialNumber: "SN-123",
      costCents: 25000,
      isNfa: true,
      firearmId: faOne.id,
      installedDate: "2020-01-01",
    });

    const moved = await mountAccessory(owner, acc.id, faTwo.id);
    expect(moved.currentFirearmId).toBe(faTwo.id);
    expect(moved.serialNumber).toBe("SN-123");
    expect(moved.costCents).toBe(25000);
    expect(moved.isNfa).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect(moved.installedDate).toBe(today);
  });

  test("mountAccessory: unmounting clears currentFirearmId and installedDate", async () => {
    const fa = await makeFirearm(owner, { name: "Unmount source FA" });
    const acc = await createAccessory(owner, {
      type: "other",
      category: "grip",
      firearmId: fa.id,
    });
    expect(acc.currentFirearmId).toBe(fa.id);

    const unmounted = await mountAccessory(owner, acc.id, null);
    expect(unmounted.currentFirearmId).toBeNull();
    expect(unmounted.installedDate).toBeNull();
  });

  test("listAccessories returns only the visible set", async () => {
    const userD = await createUser("AccSvcD");
    await createAccessory(userD, { type: "optic", category: "optic" });
    await createAccessory(userD, { type: "other", category: "grip" });

    const list = await listAccessories(userD);
    expect(list.length).toBe(2);
    const categories = list.map((a) => a.category);
    expect([...categories].sort()).toEqual(["grip", "optic"]);

    const empty = await createUser("AccSvcEmpty");
    expect(await listAccessories(empty)).toEqual([]);
    await deleteUsers(userD, empty);
  });

  test("getAccessory on an unmounted accessory outside the visible set throws NotFoundError", async () => {
    const acc = await createAccessory(owner, {
      type: "other",
      category: "stock",
    });
    await expect(getAccessory(outsider, acc.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a firearm edit-grantee can update AND delete a mounted accessory, but a non-owner cannot delete an unmounted one", async () => {
    const grantee = await createUser("AccSvcEditGrantee");
    const fa = await makeFirearm(owner, { name: "Grantee-editable FA" });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    const mounted = await createAccessory(owner, {
      type: "light",
      category: "light",
      firearmId: fa.id,
    });

    const updated = await updateAccessory(grantee, mounted.id, {
      type: "light",
      category: "light",
      brand: "SureFire",
    });
    expect(updated.brand).toBe("SureFire");

    await deleteAccessory(grantee, mounted.id);
    await expect(getAccessory(owner, mounted.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const unmounted = await createAccessory(owner, {
      type: "other",
      category: "bipod",
    });
    await expectRejects(() => deleteAccessory(grantee, unmounted.id));

    await deleteUsers(grantee);
  });

  test("updateAccessory/deleteAccessory on a non-visible accessory throws NotFoundError", async () => {
    const acc = await createAccessory(owner, {
      type: "muzzle device",
      category: "muzzle device",
    });
    await expect(
      updateAccessory(outsider, acc.id, {
        type: "muzzle device",
        category: "muzzle device",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAccessory(outsider, acc.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a firearm VIEW-grantee cannot update, delete, or mount its mounted accessory (NotAuthorizedError)", async () => {
    const viewer = await createUser("AccSvcViewGrantee");
    const fa = await makeFirearm(owner, { name: "View-grantee FA" });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const mounted = await createAccessory(owner, {
      type: "optic",
      category: "optic",
      firearmId: fa.id,
    });

    await expect(
      updateAccessory(viewer, mounted.id, {
        type: "optic",
        category: "optic",
        brand: "X",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(deleteAccessory(viewer, mounted.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    await expect(
      mountAccessory(viewer, mounted.id, null),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    await deleteUsers(viewer);
  });

  test("createAccessory with a firearmId owned by a different user than the accessory's resolved owner throws (cross-tenant mount guard)", async () => {
    const otherOwnersFirearm = await makeFirearm(outsider, {
      name: "Cross-tenant create-mount target FA",
    });
    // The actor (owner) can edit the outsider's firearm via a grant, but the
    // new accessory's resolved owner is the actor themself — the firearm
    // owner and the accessory owner differ, so `authorizeCreateMount` must
    // reject even though the actor holds edit rights on the target.
    await createGrant(db, {
      actorId: outsider,
      granteeId: owner,
      parentType: "firearm",
      parentId: otherOwnersFirearm.id,
      permission: "edit",
    });

    await expect(
      createAccessory(owner, {
        type: "optic",
        category: "optic",
        firearmId: otherOwnersFirearm.id,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });
});

// Acquired date round-trip — added during implementation, mirroring
// `src/domain/firearms/__tests__/service.test.ts`'s "acquired date (U6)"
// suite exactly (service-intervals plan R22/KTD9-parity). The origin-date
// derivation itself is covered in
// `src/domain/service-intervals/__tests__/due-service.test.ts`; this suite
// covers only create/update/clear and the validation gate.
describe("accessory service — acquired date", () => {
  let userA = "";

  beforeAll(async () => {
    userA = await createUser("AccAcquiredDate");
  });
  afterAll(async () => {
    await deleteUsers(userA);
  });

  test("creating without an acquired date stores null", async () => {
    const acc = await createAccessory(userA, {
      type: "optic",
      category: "optic",
    });
    expect(acc.acquiredDate).toBeNull();
  });

  test("creating with an acquired date persists it", async () => {
    const acc = await createAccessory(userA, {
      type: "optic",
      category: "optic",
      acquiredDate: "2026-06-14",
    });
    expect(acc.acquiredDate).toBe("2026-06-14");
  });

  test("an update can set an acquired date that was previously unset", async () => {
    const acc = await createAccessory(userA, {
      type: "optic",
      category: "optic",
    });
    expect(acc.acquiredDate).toBeNull();
    const updated = await updateAccessory(userA, acc.id, {
      type: "optic",
      category: "optic",
      acquiredDate: "2026-03-01",
    });
    expect(updated.acquiredDate).toBe("2026-03-01");
  });

  test("an update can clear a previously-set acquired date back to null", async () => {
    const acc = await createAccessory(userA, {
      type: "optic",
      category: "optic",
      acquiredDate: "2026-01-01",
    });
    expect(acc.acquiredDate).toBe("2026-01-01");
    const cleared = await updateAccessory(userA, acc.id, {
      type: "optic",
      category: "optic",
      acquiredDate: null,
    });
    expect(cleared.acquiredDate).toBeNull();
  });

  test("a malformed acquired date is rejected and writes no row (create)", async () => {
    const before = await listAccessories(userA);
    await expect(
      createAccessory(userA, {
        type: "optic",
        category: "optic",
        acquiredDate: "not-a-date",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listAccessories(userA);
    expect(after.length).toBe(before.length);
  });

  test("a malformed acquired date is rejected and leaves the existing row unchanged (update)", async () => {
    const acc = await createAccessory(userA, {
      type: "optic",
      category: "optic",
      acquiredDate: "2026-01-01",
    });
    await expect(
      updateAccessory(userA, acc.id, {
        type: "optic",
        category: "optic",
        acquiredDate: "2026-13-40",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const { accessory: row } = await getAccessory(userA, acc.id);
    expect(row.acquiredDate).toBe("2026-01-01");
  });

  test("acquiredDate is independent of mount/unmount — unmounting never clears it (unlike installedDate)", async () => {
    const fa = await makeFirearm(userA, { name: "AcquiredIndependentFA" });
    const acc = await createAccessory(userA, {
      type: "optic",
      category: "optic",
      acquiredDate: "2020-05-01",
      firearmId: fa.id,
      installedDate: "2026-01-01",
    });
    expect(acc.acquiredDate).toBe("2020-05-01");

    const unmounted = await mountAccessory(userA, acc.id, null);
    expect(unmounted.installedDate).toBeNull();
    expect(unmounted.acquiredDate).toBe("2020-05-01");
  });
});
