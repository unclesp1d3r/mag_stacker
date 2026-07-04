import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { magazine, user } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import { listPrefixes } from "@/src/domain/magazines/prefixes";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import { bulkAddMagazines } from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

function template() {
  return {
    brandModel: "PMAG",
    caliber: "9mm",
    baseCapacity: 15,
    extensionRounds: 0,
  };
}

async function ownerMagCount(ownerId: string): Promise<number> {
  const rows = await db
    .select({ id: magazine.id })
    .from(magazine)
    .where(eq(magazine.ownerId, ownerId));
  return rows.length;
}

live("bulkAddMagazines (U10)", () => {
  let userA = "";
  let userB = "";
  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("covers AE8: sequence continues across repeat bulk adds", async () => {
    const owner = await createUser("seq");
    const first = await bulkAddMagazines(owner, template(), 3, "AR-");
    expect(first.map((m) => m.label)).toEqual(["AR-01", "AR-02", "AR-03"]);
    const second = await bulkAddMagazines(owner, template(), 2, "AR-");
    expect(second.map((m) => m.label)).toEqual(["AR-04", "AR-05"]);
    await deleteUsers(owner);
  });

  test("count 0 and count 1001 are rejected before any write (R53)", async () => {
    const owner = await createUser("reject");
    await expect(
      bulkAddMagazines(owner, template(), 0, "AR-"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      bulkAddMagazines(owner, template(), 1001, "AR-"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await ownerMagCount(owner)).toBe(0);
    await deleteUsers(owner);
  });

  test("each generated magazine has its own identity and deep-copied compatibility (R56)", async () => {
    const fa = await makeFirearm(userA, { name: "DC FA" });
    const created = await bulkAddMagazines(
      userA,
      { ...template(), compatibleFirearmIds: [fa.id] },
      3,
      "DC-",
    );
    const ids = new Set(created.map((m) => m.id));
    expect(ids.size).toBe(3); // distinct identities
    for (const mag of created) {
      expect(mag.compatibleFirearmIds).toEqual([fa.id]);
    }
  });

  test("a failure mid-batch rolls back all N (atomicity, R57)", async () => {
    const before = await ownerMagCount(userA);
    const bFirearm = await makeFirearm(userB, { name: "B private" }); // not visible to A
    await expect(
      bulkAddMagazines(
        userA,
        { ...template(), compatibleFirearmIds: [bFirearm.id] },
        5,
        "FAIL-",
      ),
    ).rejects.toThrow();
    expect(await ownerMagCount(userA)).toBe(before); // zero added
  });

  test("create-on-behalf: an edit-grantee with the flag creates records owned by the inventory owner (KTD-5)", async () => {
    // A grants B an edit grant WITH create-on-behalf (anchored on some item).
    const anchor = await makeFirearm(userA, { name: "anchor" });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: anchor.id,
      permission: "edit",
      allowCreateOnBehalf: true,
    });
    const onBehalf = await bulkAddMagazines(userB, template(), 2, "OB-", {
      ownerId: userA,
    });
    for (const mag of onBehalf) {
      expect(mag.ownerId).toBe(userA);
    }
    // Without a target owner, B creates records owned by B.
    const ownByB = await bulkAddMagazines(userB, template(), 1, "SELF-");
    expect(ownByB[0].ownerId).toBe(userB);
  });

  test("re-submitting the same idempotency key returns the original result without a second batch (R69)", async () => {
    const owner = await createUser("idem");
    const key = `bulk-${crypto.randomUUID()}`;
    const first = await bulkAddMagazines(owner, template(), 4, "ID-", {
      idempotencyKey: key,
    });
    const replay = await bulkAddMagazines(owner, template(), 4, "ID-", {
      idempotencyKey: key,
    });
    expect(replay.map((m) => m.id)).toEqual(first.map((m) => m.id));
    expect(await ownerMagCount(owner)).toBe(4); // not 8
    await deleteUsers(owner);
  });
});

live("bulkAddMagazines — Magpul mode (owner-governed)", () => {
  async function magpulOwner(name: string): Promise<string> {
    const id = await createUser(name);
    await db.update(user).set({ magpulMode: true }).where(eq(user.id, id));
    return id;
  }

  async function codesFrom(promise: Promise<unknown>): Promise<string[]> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof ValidationError) return e.codes;
      throw e;
    }
    throw new Error("expected a ValidationError, but none was thrown");
  }

  test("mode on: conforming prefix generates uppercased labels within the cap", async () => {
    const owner = await magpulOwner("mp-ok");
    const created = await bulkAddMagazines(owner, template(), 3, "ab");
    expect(created.map((m) => m.label)).toEqual(["AB01", "AB02", "AB03"]);
    await deleteUsers(owner);
  });

  test("mode on: prefix that pushes labels past 4 chars is rejected (magpulLabelTooLong)", async () => {
    const owner = await magpulOwner("mp-long");
    const codes = await codesFrom(
      bulkAddMagazines(owner, template(), 2, "ABC"),
    );
    expect(codes).toContain("magpulLabelTooLong");
    expect(await ownerMagCount(owner)).toBe(0); // atomic: nothing written
    await deleteUsers(owner);
  });

  test("mode on: prefix with a disallowed character is rejected (invalidMagpulLabel)", async () => {
    const owner = await magpulOwner("mp-bad");
    const codes = await codesFrom(bulkAddMagazines(owner, template(), 2, "A."));
    expect(codes).toContain("invalidMagpulLabel");
    expect(await ownerMagCount(owner)).toBe(0);
    await deleteUsers(owner);
  });

  test("mode on: empty prefix produces empty labels and is allowed", async () => {
    const owner = await magpulOwner("mp-empty");
    const created = await bulkAddMagazines(owner, template(), 2, "");
    expect(created.map((m) => m.label)).toEqual(["", ""]);
    await deleteUsers(owner);
  });

  test("mode off: a nonconforming prefix is stored verbatim (unconstrained)", async () => {
    const owner = await createUser("mp-off");
    const created = await bulkAddMagazines(owner, template(), 2, "ABC");
    expect(created.map((m) => m.label)).toEqual(["ABC01", "ABC02"]);
    await deleteUsers(owner);
  });
});

live("bulkAddMagazines — prefix recording (#22)", () => {
  test("records the batch prefix once, even for count > 1 (R3)", async () => {
    const owner = await createUser("bulk-rec");
    await bulkAddMagazines(owner, template(), 3, "US");
    expect(await listPrefixes(owner)).toEqual(["US"]);
    await deleteUsers(owner);
  });

  test("records nothing for a blank prefix", async () => {
    const owner = await createUser("bulk-blank");
    await bulkAddMagazines(owner, template(), 2, "");
    expect(await listPrefixes(owner)).toEqual([]);
    await deleteUsers(owner);
  });
});
