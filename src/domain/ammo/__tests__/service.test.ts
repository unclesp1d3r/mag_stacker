import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { ValidationError } from "@/src/domain/errors";
import { createUser, deleteUsers } from "@/src/test-support/factories";
import {
  createAmmo,
  deleteAmmo,
  getAmmo,
  listAmmo,
  updateAmmo,
} from "../service";

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

live("ammo service (ammo plan U3)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    userA = await createUser("AmmoSvcA");
    userB = await createUser("AmmoSvcB");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("covers AE1: invalid input throws ValidationError and writes no row", async () => {
    const before = await listAmmo(userA);
    await expect(
      createAmmo(userA, {
        caliber: "",
        grain: -1,
        quantityRounds: -1,
        lowStockThreshold: -1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listAmmo(userA);
    expect(after.length).toBe(before.length);
  });

  test("createAmmo persists an owned lot; getAmmo returns it with permission 'owner'", async () => {
    const lot = await createAmmo(userA, {
      brand: "Federal",
      caliber: "9mm",
      type: "FMJ",
      grain: 115,
      quantityRounds: 500,
      lowStockThreshold: 50,
    });
    expect(lot.ownerId).toBe(userA);
    expect(lot.brand).toBe("Federal");

    const { ammo, permission } = await getAmmo(userA, lot.id);
    expect(ammo.id).toBe(lot.id);
    expect(permission).toBe("owner");
  });

  test("two identical brand/caliber/type/grain lots both persist as distinct rows (R7, never merged)", async () => {
    const first = await createAmmo(userA, {
      brand: "Federal",
      caliber: ".223",
      type: "Match",
      grain: 77,
      quantityRounds: 200,
      lowStockThreshold: 20,
    });
    const second = await createAmmo(userA, {
      brand: "Federal",
      caliber: ".223",
      type: "Match",
      grain: 77,
      quantityRounds: 200,
      lowStockThreshold: 20,
    });
    expect(first.id).not.toBe(second.id);
    const list = await listAmmo(userA);
    const ids = list.map((a) => a.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
  });

  test("createAmmo with edit + allowCreateOnBehalf grant persists under owner; without opt-in it is rejected", async () => {
    // Seed a grant target lot so B has an active edit grant with create-on-behalf.
    const seed = await createAmmo(userA, {
      caliber: "9mm",
      grain: 115,
      quantityRounds: 10,
      lowStockThreshold: 0,
    });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "ammo",
      parentId: seed.id,
      permission: "edit",
      allowCreateOnBehalf: true,
    });
    const created = await createAmmo(userB, {
      caliber: "9mm",
      grain: 124,
      quantityRounds: 300,
      lowStockThreshold: 30,
      ownerId: userA,
    });
    expect(created.ownerId).toBe(userA);

    // D holds an edit grant but WITHOUT the create-on-behalf opt-in — the
    // create-on-behalf attempt is rejected (the opt-in, not the grant, gates it).
    const userD = await createUser("AmmoSvcD");
    const seedD = await createAmmo(userA, {
      caliber: "9mm",
      grain: 115,
      quantityRounds: 10,
      lowStockThreshold: 0,
    });
    await createGrant(db, {
      actorId: userA,
      granteeId: userD,
      parentType: "ammo",
      parentId: seedD.id,
      permission: "edit",
      allowCreateOnBehalf: false,
    });
    await expect(
      createAmmo(userD, {
        caliber: "9mm",
        grain: 124,
        quantityRounds: 300,
        lowStockThreshold: 30,
        ownerId: userA,
      }),
    ).rejects.toThrow();
    await deleteUsers(userD);

    // C has no grant at all from A — create-on-behalf is rejected.
    const userC = await createUser("AmmoSvcC");
    await expect(
      createAmmo(userC, {
        caliber: "9mm",
        grain: 124,
        quantityRounds: 300,
        lowStockThreshold: 30,
        ownerId: userA,
      }),
    ).rejects.toThrow();
    await deleteUsers(userC);
  });

  test("updateAmmo clears omitted optional text fields (empty-not-null, R18)", async () => {
    const lot = await createAmmo(userA, {
      brand: "Federal",
      caliber: "9mm",
      type: "FMJ",
      grain: 115,
      quantityRounds: 100,
      lowStockThreshold: 10,
      notes: "range stock",
    });
    // Update omitting brand/type/notes — a full-field replace clears them to "".
    const updated = await updateAmmo(userA, lot.id, {
      caliber: "9mm",
      grain: 115,
      quantityRounds: 100,
      lowStockThreshold: 10,
    });
    expect(updated.brand).toBe("");
    expect(updated.type).toBe("");
    expect(updated.notes).toBe("");
  });

  test("updateAmmo/deleteAmmo on a non-visible lot throws NotFoundError", async () => {
    const lot = await createAmmo(userA, {
      caliber: "9mm",
      grain: 115,
      quantityRounds: 100,
      lowStockThreshold: 10,
    });
    const outsider = await createUser("AmmoSvcOutsider");
    await expect(
      updateAmmo(outsider, lot.id, {
        caliber: "9mm",
        grain: 115,
        quantityRounds: 100,
        lowStockThreshold: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAmmo(outsider, lot.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await deleteUsers(outsider);
  });

  test("updateAmmo persists changes and validates; deleteAmmo removes the row", async () => {
    const lot = await createAmmo(userA, {
      caliber: "9mm",
      grain: 115,
      quantityRounds: 100,
      lowStockThreshold: 10,
    });
    const updated = await updateAmmo(userA, lot.id, {
      caliber: "9mm",
      grain: 115,
      quantityRounds: 5,
      lowStockThreshold: 10,
    });
    expect(updated.quantityRounds).toBe(5);

    await expectRejects(() =>
      updateAmmo(userA, lot.id, {
        caliber: "",
        grain: -1,
        quantityRounds: -1,
        lowStockThreshold: -1,
      }),
    );

    await deleteAmmo(userA, lot.id);
    await expect(getAmmo(userA, lot.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("listAmmo returns only visible lots, ordered caliber then brand then grain", async () => {
    const userD = await createUser("AmmoSvcD");
    await createAmmo(userD, {
      brand: "Zeta",
      caliber: "9mm",
      grain: 147,
      quantityRounds: 10,
      lowStockThreshold: 0,
    });
    await createAmmo(userD, {
      brand: "Alpha",
      caliber: "9mm",
      grain: 115,
      quantityRounds: 10,
      lowStockThreshold: 0,
    });
    await createAmmo(userD, {
      brand: "Alpha",
      caliber: ".223",
      grain: 55,
      quantityRounds: 10,
      lowStockThreshold: 0,
    });
    const list = await listAmmo(userD);
    const shaped = list.map((a) => [a.caliber, a.brand, a.grain] as const);
    const sorted = [...shaped].sort((a, b) => {
      if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
      if (a[1] !== b[1]) return a[1].localeCompare(b[1]);
      return a[2] - b[2];
    });
    expect(shaped).toEqual(sorted);

    const outsider = await createUser("AmmoSvcEmpty");
    expect(await listAmmo(outsider)).toEqual([]);
    await deleteUsers(userD, outsider);
  });
});
