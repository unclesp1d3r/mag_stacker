import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
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

  test("a firearm SHARED to the actor is linkable on BOTH (the gate is visibility, not ownership)", async () => {
    // The suite otherwise only proves rejection. The rule is that the gate
    // checks VISIBILITY, so a cross-owner firearm shared to the actor must be
    // linkable — testing only the negative would still pass if the gate were
    // wrongly narrowed to ownership.
    const otherOwner = await createUser("RelationSharer");
    try {
      const shared = await makeFirearm(otherOwner, { name: "Shared Host" });
      await createGrant(db, {
        actorId: otherOwner,
        granteeId: owner,
        parentType: "firearm",
        parentId: shared.id,
        permission: "view",
      });

      const [mag, acc] = await bothSet([firearmA, shared.id]);
      expect(mag).toEqual([firearmA, shared.id]);
      expect(acc).toEqual(mag);
    } finally {
      await deleteUsers(otherOwner);
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

/**
 * The read side is viewer-relative, so the list an editor submits is only ever
 * an edit of the portion they were SHOWN. A wholesale delete-then-reinsert
 * therefore destroys links the editor was never told existed — silently, with
 * no error, and invisibly to the owner.
 *
 * These tests pin the pairing of the two rules rather than either one alone:
 * "reads drop what you cannot see" is only safe if "writes preserve what you
 * cannot see" holds too. Both bindings are driven, because the whole point of
 * the shared core is that they cannot diverge on an authorization rule.
 */
describe("a write never destroys links outside the actor's visible set", () => {
  let owner: string;
  let editor: string;
  let visibleHost: string;
  let hiddenHost: string;
  let magazineId: string;
  let accessoryId: string;

  beforeAll(async () => {
    owner = await createUser("PreserveOwner");
    editor = await createUser("PreserveEditor");
    visibleHost = (await makeFirearm(owner, { name: "Preserve Shown" })).id;
    hiddenHost = (await makeFirearm(owner, { name: "Preserve Unshown" })).id;
    magazineId = (await makeMagazine(owner)).id;
    accessoryId = (await createAccessory(owner, { type: "suppressor" })).id;

    // The editor can see exactly ONE of the two hosts, so every compatibility
    // read they get back is a strict subset of what is actually linked.
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: visibleHost,
      permission: "view",
    });
  });

  afterAll(async () => {
    await deleteUsers(owner, editor);
  });

  /** Owner links both hosts — the state the editor is about to edit blind. */
  async function ownerLinksBoth(): Promise<void> {
    const ids = [hiddenHost, visibleHost];
    await db.transaction((tx) =>
      replaceMagazineCompatibility(tx, owner, magazineId, ids),
    );
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, accessoryId, ids),
    );
  }

  test("round-tripping the filtered list keeps the hidden link on BOTH", async () => {
    await ownerLinksBoth();

    // Exactly what a form hands back after a viewer-relative read.
    expect(await loadMagazineCompatibility(db, editor, magazineId)).toEqual([
      visibleHost,
    ]);
    expect(await loadAccessoryCompatibility(db, editor, accessoryId)).toEqual([
      visibleHost,
    ]);

    await db.transaction((tx) =>
      replaceMagazineCompatibility(tx, editor, magazineId, [visibleHost]),
    );
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, editor, accessoryId, [visibleHost]),
    );

    expect(await loadMagazineCompatibility(db, owner, magazineId)).toEqual([
      hiddenHost,
      visibleHost,
    ]);
    expect(await loadAccessoryCompatibility(db, owner, accessoryId)).toEqual([
      hiddenHost,
      visibleHost,
    ]);
  });

  test("clearing what they CAN see leaves the rest intact on BOTH", async () => {
    await ownerLinksBoth();

    await db.transaction((tx) =>
      replaceMagazineCompatibility(tx, editor, magazineId, []),
    );
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, editor, accessoryId, []),
    );

    // "Omission clears" still holds — but only over what the actor was shown.
    expect(await loadMagazineCompatibility(db, editor, magazineId)).toEqual([]);
    expect(await loadAccessoryCompatibility(db, editor, accessoryId)).toEqual(
      [],
    );
    expect(await loadMagazineCompatibility(db, owner, magazineId)).toEqual([
      hiddenHost,
    ]);
    expect(await loadAccessoryCompatibility(db, owner, accessoryId)).toEqual([
      hiddenHost,
    ]);
  });
});
