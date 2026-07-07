import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  makeAmmo,
} from "@/src/test-support/factories";
import { buildAmmoCsv } from "../ammo-build";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("buildAmmoCsv (ammo plan U6, viewer-relative)", () => {
  let userA = "";
  let userB = "";
  beforeAll(async () => {
    userA = await createUser("ammoA");
    userB = await createUser("ammoB");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("an empty inventory yields header only", async () => {
    const csv = await buildAmmoCsv(userB);
    expect(csv.split("\n").filter((l) => l.length > 0)).toHaveLength(1);
  });

  test("includes the actor's own ammo lots with computed low-stock status", async () => {
    await makeAmmo(userA, {
      brand: "OwnedLot",
      caliber: "9mm",
      quantityRounds: 5,
      lowStockThreshold: 20,
    });
    const csv = await buildAmmoCsv(userA);
    expect(csv).toContain("OwnedLot");
    expect(csv).toContain(",Yes,"); // low-stock column
  });

  test("a lot owned by another user and not shared is not visible", async () => {
    await makeAmmo(userA, { brand: "SecretLot" });
    const csvB = await buildAmmoCsv(userB);
    expect(csvB).not.toContain("SecretLot");
  });

  test("a lot shared via grant becomes visible to the grantee", async () => {
    const shared = await makeAmmo(userA, { brand: "SharedLot" });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "ammo",
      parentId: shared.id,
      permission: "view",
    });
    const csvB = await buildAmmoCsv(userB);
    expect(csvB).toContain("SharedLot");
  });
});
