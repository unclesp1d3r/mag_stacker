import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { createMagazine } from "@/src/domain/magazines/service";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import { buildInventoryCsv } from "../build";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("buildInventoryCsv (U8, viewer-relative)", () => {
  let userA = "";
  let userB = "";
  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("an empty inventory yields header only", async () => {
    const csv = await buildInventoryCsv(userB);
    expect(csv.split("\n").filter((l) => l.length > 0)).toHaveLength(1);
  });

  test("resolves visible compatible firearm names; magazine appears with its data", async () => {
    const fa = await makeFirearm(userA, { name: "Glock 19" });
    await createMagazine(userA, {
      brandModel: "PMAG-EXPORT",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 2,
      compatibleFirearmIds: [fa.id],
    });
    const csv = await buildInventoryCsv(userA);
    expect(csv).toContain("PMAG-EXPORT");
    expect(csv).toContain("Glock 19");
    expect(csv).toContain(",17,"); // effective capacity in-line
  });

  test("a compatibility reference outside the viewer's visible set is omitted (R17a/R44)", async () => {
    // A links a magazine to one of A's firearms, then shares ONLY the magazine
    // (not the firearm) with B. B's export must omit the firearm name.
    const secretFa = await makeFirearm(userA, { name: "SecretScope" });
    const mag = await createMagazine(userA, {
      brandModel: "SharedMag",
      caliber: "9mm",
      baseCapacity: 10,
      extensionRounds: 0,
      compatibleFirearmIds: [secretFa.id],
    });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "magazine",
      parentId: mag.id,
      permission: "view",
    });

    const csvB = await buildInventoryCsv(userB);
    expect(csvB).toContain("SharedMag"); // B sees the magazine
    expect(csvB).not.toContain("SecretScope"); // but not the unseen firearm name
  });
});
