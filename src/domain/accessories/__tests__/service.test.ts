import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NotFoundError } from "@/src/auth/errors";
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

live("accessory service (accessory plan U4)", () => {
  let owner = "";
  let outsider = "";

  beforeAll(async () => {
    owner = await createUser("AccSvcOwner");
    outsider = await createUser("AccSvcOutsider");
  });
  afterAll(async () => {
    await deleteUsers(owner, outsider);
  });

  test("covers invalid input: blank category throws ValidationError and writes no row", async () => {
    const before = await listAccessories(owner);
    await expect(
      createAccessory(owner, { category: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listAccessories(owner);
    expect(after.length).toBe(before.length);
  });

  test("createAccessory persists an unmounted accessory; getAccessory returns it with permission 'owner'", async () => {
    const acc = await createAccessory(owner, {
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
      category: "sling",
      firearmId: fa.id,
    });
    expect(acc.currentFirearmId).toBe(fa.id);
  });

  test("mountAccessory: moving between two same-owner firearms preserves fields and resets installedDate", async () => {
    const faOne = await makeFirearm(owner, { name: "Source FA" });
    const faTwo = await makeFirearm(owner, { name: "Destination FA" });
    const acc = await createAccessory(owner, {
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
    await createAccessory(userD, { category: "optic" });
    await createAccessory(userD, { category: "grip" });

    const list = await listAccessories(userD);
    expect(list.length).toBe(2);
    const categories = list.map((a) => a.category);
    expect([...categories].sort()).toEqual(["grip", "optic"]);

    const empty = await createUser("AccSvcEmpty");
    expect(await listAccessories(empty)).toEqual([]);
    await deleteUsers(userD, empty);
  });

  test("getAccessory on an unmounted accessory outside the visible set throws NotFoundError", async () => {
    const acc = await createAccessory(owner, { category: "stock" });
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
      category: "light",
      firearmId: fa.id,
    });

    const updated = await updateAccessory(grantee, mounted.id, {
      category: "light",
      brand: "SureFire",
    });
    expect(updated.brand).toBe("SureFire");

    await deleteAccessory(grantee, mounted.id);
    await expect(getAccessory(owner, mounted.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const unmounted = await createAccessory(owner, { category: "bipod" });
    await expectRejects(() => deleteAccessory(grantee, unmounted.id));

    await deleteUsers(grantee);
  });

  test("updateAccessory/deleteAccessory on a non-visible accessory throws NotFoundError", async () => {
    const acc = await createAccessory(owner, { category: "muzzle device" });
    await expect(
      updateAccessory(outsider, acc.id, { category: "muzzle device" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAccessory(outsider, acc.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
