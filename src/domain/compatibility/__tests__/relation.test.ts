import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NotFoundError } from "@/src/auth/errors";
import { db } from "@/src/db/client";
import {
  loadAccessoryCompatibility,
  replaceAccessoryCompatibility,
} from "@/src/domain/accessories/compatibility";
import { createAccessory } from "@/src/domain/accessories/service";
import {
  dedupeFirearmIds,
  loadCompatibility as loadMagazineCompatibility,
  replaceCompatibility as replaceMagazineCompatibility,
} from "@/src/domain/magazines/compatibility";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeMagazine,
} from "@/src/test-support/factories";

/**
 * `src/domain/compatibility/relation.ts` exists for exactly one reason: the
 * magazine and accessory compatibility relations must behave IDENTICALLY, and
 * the invariant most worth not duplicating is the visibility gate that refuses
 * to link a firearm the actor cannot see.
 *
 * Testing the core through a synthetic third binding would prove less than
 * this does. These tests drive the two REAL bindings through the same
 * scenarios and assert their answers match — which is the property that would
 * actually break if someone edited one wrapper and not the other, or
 * re-implemented the core for one parent.
 */

describe("dedupeFirearmIds (pure)", () => {
  test("collapses duplicates preserving FIRST-occurrence order", () => {
    expect(dedupeFirearmIds(["a", "b", "a", "c", "b"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("is a no-op on an already-unique list, and safe on an empty one", () => {
    expect(dedupeFirearmIds(["a", "b"])).toEqual(["a", "b"]);
    expect(dedupeFirearmIds([])).toEqual([]);
  });

  test("does not mutate its input", () => {
    const input = ["a", "a", "b"];
    dedupeFirearmIds(input);
    expect(input).toEqual(["a", "a", "b"]);
  });
});

describe("magazine and accessory compatibility behave identically", () => {
  let owner: string;
  let outsider: string;
  let firearmA: string;
  let firearmB: string;
  let magazineId: string;
  let accessoryId: string;

  beforeAll(async () => {
    owner = await createUser("RelationOwner");
    outsider = await createUser("RelationOutsider");
    firearmA = (await makeFirearm(owner, { name: "Relation Host A" })).id;
    firearmB = (await makeFirearm(owner, { name: "Relation Host B" })).id;
    magazineId = (await makeMagazine(owner)).id;
    accessoryId = (await createAccessory(owner, { type: "suppressor" })).id;
  });

  afterAll(async () => {
    await deleteUsers(owner, outsider);
  });

  /** Run the same scenario against both bindings and return both answers. */
  async function bothSet(ids: string[]): Promise<[string[], string[]]> {
    await db.transaction((tx) =>
      replaceMagazineCompatibility(tx, owner, magazineId, ids),
    );
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, accessoryId, ids),
    );
    return [
      await loadMagazineCompatibility(db, owner, magazineId),
      await loadAccessoryCompatibility(db, owner, accessoryId),
    ];
  }

  test("ordinal order matches", async () => {
    const [mag, acc] = await bothSet([firearmB, firearmA]);
    expect(mag).toEqual([firearmB, firearmA]);
    expect(acc).toEqual(mag);
  });

  test("duplicate collapsing matches", async () => {
    const [mag, acc] = await bothSet([firearmA, firearmA, firearmB]);
    expect(mag).toEqual([firearmA, firearmB]);
    expect(acc).toEqual(mag);
  });

  test("replace-not-merge matches", async () => {
    await bothSet([firearmA, firearmB]);
    const [mag, acc] = await bothSet([firearmB]);
    expect(mag).toEqual([firearmB]);
    expect(acc).toEqual(mag);
  });

  test("clearing to empty matches", async () => {
    const [mag, acc] = await bothSet([]);
    expect(mag).toEqual([]);
    expect(acc).toEqual(mag);
  });

  test("the visibility gate rejects an unseeable firearm on BOTH", async () => {
    const strangerId = await createUser("RelationStranger");
    try {
      const hidden = await makeFirearm(strangerId, { name: "Relation Hidden" });

      await expect(
        db.transaction((tx) =>
          replaceMagazineCompatibility(tx, owner, magazineId, [hidden.id]),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);

      await expect(
        db.transaction((tx) =>
          replaceAccessoryCompatibility(tx, owner, accessoryId, [hidden.id]),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await deleteUsers(strangerId);
    }
  });

  test("viewer-relative reads drop unseen firearms on BOTH", async () => {
    await bothSet([firearmA, firearmB]);
    expect(await loadMagazineCompatibility(db, outsider, magazineId)).toEqual(
      [],
    );
    expect(await loadAccessoryCompatibility(db, outsider, accessoryId)).toEqual(
      [],
    );
  });
});
