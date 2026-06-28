import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { firearm, magazineFirearm } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  linkMagazineFirearm,
  makeMagazine,
} from "@/src/test-support/factories";
import {
  createFirearm,
  deleteFirearm,
  getFirearm,
  listFirearms,
  updateFirearm,
} from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("firearms service (U5)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("covers AE1 path: invalid input throws ValidationError and writes no row (R21)", async () => {
    const before = await listFirearms(userA);
    await expect(
      createFirearm(userA, { name: "", caliber: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listFirearms(userA);
    expect(after.length).toBe(before.length);
  });

  test("create assigns ownership to the acting user (R8)", async () => {
    const fa = await createFirearm(userA, { name: "Glock 19", caliber: "9mm" });
    expect(fa.ownerId).toBe(userA);
    expect(fa.manufacturer).toBe("");
    expect(fa.notes).toBe("");
  });

  test("a non-empty value with surrounding whitespace persists verbatim (R19)", async () => {
    const fa = await createFirearm(userA, {
      name: "  Spacey  ",
      caliber: " 9mm ",
    });
    expect(fa.name).toBe("  Spacey  ");
    expect(fa.caliber).toBe(" 9mm ");
  });

  test("list returns owned+shared ordered by name ascending; empty is [] (R22/R68)", async () => {
    const empty = await listFirearms(userB);
    expect(empty).toEqual([]);

    await createFirearm(userA, { name: "Zeta", caliber: "9mm" });
    await createFirearm(userA, { name: "Alpha", caliber: "9mm" });
    const list = await listFirearms(userA);
    const names = list.map((f) => f.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);

    // A firearm shared to B shows up in B's list.
    const shared = await createFirearm(userA, {
      name: "Shared",
      caliber: "9mm",
    });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: shared.id,
      permission: "view",
    });
    const bList = await listFirearms(userB);
    expect(bList.map((f) => f.id)).toContain(shared.id);
  });

  test("clearing Manufacturer/Notes on update persists the empty value (R18)", async () => {
    const fa = await createFirearm(userA, {
      name: "Clearable",
      caliber: "9mm",
      manufacturer: "Glock",
      notes: "some notes",
    });
    const updated = await updateFirearm(userA, fa.id, {
      name: "Clearable",
      caliber: "9mm",
    });
    expect(updated.manufacturer).toBe("");
    expect(updated.notes).toBe("");
  });

  test("deleting a firearm referenced by magazines succeeds; magazines survive with it dropped (R23)", async () => {
    const fa = await createFirearm(userA, { name: "Linked", caliber: "9mm" });
    const mag = await makeMagazine(userA);
    await linkMagazineFirearm(mag.id, fa.id);

    await deleteFirearm(userA, fa.id);

    const remaining = await db
      .select()
      .from(firearm)
      .where(eq(firearm.id, fa.id));
    expect(remaining).toHaveLength(0);
    const joins = await db
      .select()
      .from(magazineFirearm)
      .where(eq(magazineFirearm.firearmId, fa.id));
    expect(joins).toHaveLength(0); // magazine's compatibility dropped this firearm
  });

  test("get-by-id for another user's unshared firearm returns not-found (R9/R70)", async () => {
    const fa = await createFirearm(userA, { name: "Private", caliber: "9mm" });
    await expect(getFirearm(userB, fa.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
