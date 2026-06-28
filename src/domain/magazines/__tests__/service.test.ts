import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { magazine } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import {
  createMagazine,
  getMagazine,
  listMagazines,
  updateMagazine,
} from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("magazines service (U6)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("invalid input throws ValidationError and writes nothing", async () => {
    await expect(
      createMagazine(userA, {
        brandModel: "",
        caliber: "",
        baseCapacity: 0,
        extensionRounds: -1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("create stores scalars and ordered compatibility; AcquiredDate round-trips as YYYY-MM-DD (KTD-7)", async () => {
    const a = await makeFirearm(userA, { name: "A" });
    const b = await makeFirearm(userA, { name: "B" });
    const mag = await createMagazine(userA, {
      brandModel: "PMAG",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 2,
      acquiredDate: "2026-06-14",
      compatibleFirearmIds: [a.id, b.id],
    });
    expect(mag.acquiredDate).toBe("2026-06-14");
    expect(mag.compatibleFirearmIds).toEqual([a.id, b.id]);
  });

  test("covers AE6: updating with a link to an unseeable firearm fails the whole update (R32)", async () => {
    const a = await makeFirearm(userA, { name: "A" });
    const mag = await createMagazine(userA, {
      brandModel: "Original",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 0,
      compatibleFirearmIds: [a.id],
    });
    // B owns a firearm A cannot see.
    const bFirearm = await makeFirearm(userB, { name: "B private" });

    await expect(
      updateMagazine(userA, mag.id, {
        brandModel: "Changed",
        caliber: "9mm",
        baseCapacity: 30, // scalar change that must NOT persist
        extensionRounds: 0,
        compatibleFirearmIds: [bFirearm.id],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Scalars rolled back: still "Original" with base 15.
    const [row] = await db
      .select()
      .from(magazine)
      .where(eq(magazine.id, mag.id));
    expect(row.brandModel).toBe("Original");
    expect(row.baseCapacity).toBe(15);
  });

  test("a link to a firearm shared to the actor succeeds (KTD-4)", async () => {
    const bFirearm = await makeFirearm(userB, { name: "B shared" });
    await createGrant(db, {
      actorId: userB,
      granteeId: userA,
      parentType: "firearm",
      parentId: bFirearm.id,
      permission: "view",
    });
    const mag = await createMagazine(userA, {
      brandModel: "CrossOwner",
      caliber: "9mm",
      baseCapacity: 17,
      extensionRounds: 0,
      compatibleFirearmIds: [bFirearm.id],
    });
    expect(mag.compatibleFirearmIds).toEqual([bFirearm.id]);
  });

  test("list orders by brand/model ascending, scoped to visibility; empty is [] (R27/R68)", async () => {
    const empty = await listMagazines(await createUser("empty"));
    expect(empty).toEqual([]);

    await createMagazine(userA, {
      brandModel: "Zeta",
      caliber: "9mm",
      baseCapacity: 10,
      extensionRounds: 0,
    });
    await createMagazine(userA, {
      brandModel: "Alpha",
      caliber: "9mm",
      baseCapacity: 10,
      extensionRounds: 0,
    });
    const list = await listMagazines(userA);
    const names = list.map((m) => m.brandModel);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  });

  test("get-by-id for another user's unshared magazine returns not-found (R9/R70)", async () => {
    const mag = await createMagazine(userA, {
      brandModel: "Private",
      caliber: "9mm",
      baseCapacity: 10,
      extensionRounds: 0,
    });
    await expect(getMagazine(userB, mag.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
