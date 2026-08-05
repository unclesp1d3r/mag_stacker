import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotFoundError } from "@/src/auth/errors";
import { db } from "@/src/db/client";
import { accessory, accessoryFirearm, firearm } from "@/src/db/schema";
import {
  loadAccessoryCompatibility,
  loadAccessoryCompatibilityBatch,
  replaceAccessoryCompatibility,
} from "@/src/domain/accessories/compatibility";
import {
  createAccessory,
  deleteAccessory,
  getAccessory,
  mountAccessory,
  updateAccessory,
} from "@/src/domain/accessories/service";
import { createFirearm, deleteFirearm } from "@/src/domain/firearms/service";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";

/**
 * Accessory ↔ firearm COMPATIBILITY (#23 U2, R4/R5/R6/R19).
 *
 * The load-bearing property under test is R6: compatibility ("which hosts does
 * this fit") and the current mount ("what is it on right now") are two
 * different facts, and neither write path may disturb the other. #8 shipped
 * the mount; collapsing the two would silently break `installed_date` and the
 * range-session snapshots that depend on it.
 */

describe("accessory compatibility", () => {
  let owner: string;
  let outsider: string;
  let firearmA: string;
  let firearmB: string;
  let firearmC: string;

  beforeAll(async () => {
    owner = await createUser("AccCompatOwner");
    outsider = await createUser("AccCompatOutsider");
    firearmA = (await makeFirearm(owner, { name: "Compat Host A" })).id;
    firearmB = (await makeFirearm(owner, { name: "Compat Host B" })).id;
    firearmC = (await makeFirearm(owner, { name: "Compat Host C" })).id;
  });

  afterAll(async () => {
    await deleteUsers(owner, outsider);
  });

  async function makeSuppressor(overrides = {}) {
    return createAccessory(owner, { type: "suppressor", ...overrides });
  }

  test("setting three firearms stores three rows in the supplied order", async () => {
    const acc = await makeSuppressor();
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [
        firearmC,
        firearmA,
        firearmB,
      ]),
    );
    expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([
      firearmC,
      firearmA,
      firearmB,
    ]);
  });

  test("re-setting with a shorter list leaves exactly that list (replace, not merge)", async () => {
    const acc = await makeSuppressor();
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [
        firearmA,
        firearmB,
        firearmC,
      ]),
    );
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [firearmB]),
    );
    expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([
      firearmB,
    ]);
  });

  test("clearing to an empty list removes every row", async () => {
    const acc = await makeSuppressor();
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [firearmA]),
    );
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, []),
    );
    expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([]);
  });

  test("R19: the same pair supplied twice collapses to one row, no PK conflict", async () => {
    const acc = await makeSuppressor();
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [
        firearmA,
        firearmA,
        firearmB,
        firearmA,
      ]),
    );
    // First-occurrence order is preserved, so ordinals match what was asked for.
    expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([
      firearmA,
      firearmB,
    ]);
  });

  test("R5: ordinal ordering is stable across repeated reads", async () => {
    const acc = await makeSuppressor();
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [
        firearmB,
        firearmC,
        firearmA,
      ]),
    );
    const first = await loadAccessoryCompatibility(db, owner, acc.id);
    const second = await loadAccessoryCompatibility(db, owner, acc.id);
    expect(first).toEqual([firearmB, firearmC, firearmA]);
    expect(second).toEqual(first);
  });

  test("a firearm the caller cannot see is rejected and nothing is written", async () => {
    const acc = await makeSuppressor();
    const strangerId = await createUser("AccCompatStranger");
    try {
      const hidden = await makeFirearm(strangerId, { name: "Not Yours" });
      await expect(
        db.transaction((tx) =>
          replaceAccessoryCompatibility(tx, owner, acc.id, [
            firearmA,
            hidden.id,
          ]),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
      // The whole transaction rolled back — firearmA was not left behind.
      expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([]);
    } finally {
      await deleteUsers(strangerId);
    }
  });

  test("reads are viewer-relative: a firearm outside the reader's visible set is dropped", async () => {
    const acc = await makeSuppressor();
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [firearmA, firearmB]),
    );
    // The outsider can see neither firearm, so no ids leak to them.
    expect(await loadAccessoryCompatibility(db, outsider, acc.id)).toEqual([]);
  });

  test("deleting a firearm removes its compatibility rows and leaves the accessory", async () => {
    const acc = await makeSuppressor();
    const doomed = await createFirearm(owner, {
      name: "Doomed Host",
      caliber: "9mm",
      type: "pistol",
      action: "semi-auto",
    });
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [doomed.id, firearmA]),
    );
    await deleteFirearm(owner, doomed.id);

    expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([
      firearmA,
    ]);
    const stillThere = await getAccessory(owner, acc.id);
    expect(stillThere.accessory.id).toBe(acc.id);
  });

  test("AE5: deleting the accessory removes its compatibility rows and leaves the firearms", async () => {
    const acc = await makeSuppressor();
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [firearmA, firearmB]),
    );
    await deleteAccessory(owner, acc.id);

    const orphans = await db
      .select()
      .from(accessoryFirearm)
      .where(eq(accessoryFirearm.accessoryId, acc.id));
    expect(orphans).toEqual([]);

    const survivors = await db
      .select({ id: firearm.id })
      .from(firearm)
      .where(eq(firearm.id, firearmA));
    expect(survivors).toHaveLength(1);
  });
});

/**
 * R6 — the whole reason both edges exist. These assert the two relations are
 * genuinely independent in BOTH directions, which is what stops a future
 * contributor from "simplifying" one into the other.
 */
describe("accessory compatibility is independent of the current mount (R6)", () => {
  let owner: string;
  let hostA: string;
  let hostB: string;

  beforeAll(async () => {
    owner = await createUser("AccCompatMount");
    hostA = (await makeFirearm(owner, { name: "Mount Host A" })).id;
    hostB = (await makeFirearm(owner, { name: "Mount Host B" })).id;
  });

  afterAll(async () => {
    await deleteUsers(owner);
  });

  test("declaring compatibility never sets or clears the current mount", async () => {
    const acc = await createAccessory(owner, {
      type: "suppressor",
      firearmId: hostA,
    });
    expect(acc.currentFirearmId).toBe(hostA);

    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [hostB]),
    );

    const [row] = await db
      .select({ currentFirearmId: accessory.currentFirearmId })
      .from(accessory)
      .where(eq(accessory.id, acc.id));
    // Compatible with B, still mounted on A — the two facts coexist.
    expect(row.currentFirearmId).toBe(hostA);
  });

  test("mounting and unmounting never alter compatibility", async () => {
    const acc = await createAccessory(owner, { type: "suppressor" });
    await db.transaction((tx) =>
      replaceAccessoryCompatibility(tx, owner, acc.id, [hostA, hostB]),
    );

    await mountAccessory(owner, acc.id, hostA);
    expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([
      hostA,
      hostB,
    ]);

    await mountAccessory(owner, acc.id, null);
    expect(await loadAccessoryCompatibility(db, owner, acc.id)).toEqual([
      hostA,
      hostB,
    ]);
  });

  test("an accessory can be compatible with a firearm it is not mounted on, and vice versa", async () => {
    const acc = await createAccessory(owner, {
      type: "suppressor",
      firearmId: hostA,
      compatibleFirearmIds: [hostB],
    });
    expect(acc.currentFirearmId).toBe(hostA);
    expect(acc.compatibleFirearmIds).toEqual([hostB]);
  });
});

describe("accessory compatibility through the service surface", () => {
  let owner: string;
  let hostA: string;
  let hostB: string;

  beforeAll(async () => {
    owner = await createUser("AccCompatService");
    hostA = (await makeFirearm(owner, { name: "Svc Host A" })).id;
    hostB = (await makeFirearm(owner, { name: "Svc Host B" })).id;
  });

  afterAll(async () => {
    await deleteUsers(owner);
  });

  test("create persists compatibility and returns it in order", async () => {
    const acc = await createAccessory(owner, {
      type: "suppressor",
      compatibleFirearmIds: [hostB, hostA],
    });
    expect(acc.compatibleFirearmIds).toEqual([hostB, hostA]);
    const fetched = await getAccessory(owner, acc.id);
    expect(fetched.accessory.compatibleFirearmIds).toEqual([hostB, hostA]);
  });

  test("update replaces the set wholesale", async () => {
    const acc = await createAccessory(owner, {
      type: "suppressor",
      compatibleFirearmIds: [hostA, hostB],
    });
    const updated = await updateAccessory(owner, acc.id, {
      type: "suppressor",
      compatibleFirearmIds: [hostB],
    });
    expect(updated.compatibleFirearmIds).toEqual([hostB]);
  });

  test("an unseeable firearm on create rolls the whole create back — no orphan accessory", async () => {
    const strangerId = await createUser("AccCompatCreateStranger");
    try {
      const hidden = await makeFirearm(strangerId, { name: "Hidden Host" });
      await expect(
        createAccessory(owner, {
          type: "suppressor",
          serialNumber: "SHOULD-NOT-EXIST",
          compatibleFirearmIds: [hidden.id],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);

      const leaked = await db
        .select({ id: accessory.id })
        .from(accessory)
        .where(eq(accessory.serialNumber, "SHOULD-NOT-EXIST"));
      expect(leaked).toEqual([]);
    } finally {
      await deleteUsers(strangerId);
    }
  });

  test("the batch loader groups by accessory and stays viewer-relative", async () => {
    const first = await createAccessory(owner, {
      type: "suppressor",
      compatibleFirearmIds: [hostA],
    });
    const second = await createAccessory(owner, {
      type: "optic",
      compatibleFirearmIds: [hostA, hostB],
    });

    const batch = await loadAccessoryCompatibilityBatch(
      db,
      new Set([hostA, hostB]),
      [first.id, second.id],
    );
    expect(batch.get(first.id)).toEqual([hostA]);
    expect(batch.get(second.id)).toEqual([hostA, hostB]);

    // hostB invisible to this reader → dropped, not leaked.
    const narrowed = await loadAccessoryCompatibilityBatch(
      db,
      new Set([hostA]),
      [second.id],
    );
    expect(narrowed.get(second.id)).toEqual([hostA]);
  });

  test("an empty parent list short-circuits to an empty map", async () => {
    const batch = await loadAccessoryCompatibilityBatch(db, new Set(), []);
    expect(batch.size).toBe(0);
  });
});
