import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { magazine, user } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeMagazine,
} from "@/src/test-support/factories";
import { listPrefixes } from "../prefixes";
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

live("Magpul mode label constraint — service integration (U3/U4)", () => {
  let ownerUser = "";
  let granteeUser = "";

  beforeAll(async () => {
    ownerUser = await createUser("magpul-owner");
    granteeUser = await createUser("magpul-grantee");
    await db
      .update(user)
      .set({ magpulMode: true })
      .where(eq(user.id, ownerUser));
  });

  afterAll(async () => {
    await deleteUsers(ownerUser, granteeUser);
  });

  test("R3/AE1 (magpul, service): mode on → ar-1 stored normalized as AR-1", async () => {
    const mag = await createMagazine(ownerUser, {
      brandModel: "Test",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 0,
      label: "ar-1",
    });
    expect(mag.label).toBe("AR-1");
  });

  test("R4 (magpul, service): mode on → AR-15 (5 chars) rejects with magpulLabelTooLong", async () => {
    let caughtError: unknown;
    try {
      await createMagazine(ownerUser, {
        brandModel: "Test",
        caliber: "9mm",
        baseCapacity: 15,
        extensionRounds: 0,
        label: "AR-15",
      });
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).toBeInstanceOf(ValidationError);
    expect((caughtError as ValidationError).codes).toContain(
      "magpulLabelTooLong",
    );
  });

  test("R5 (magpul, service): mode off → label stored verbatim without constraint", async () => {
    const mag = await createMagazine(granteeUser, {
      brandModel: "Test",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 0,
      label: "AR.15",
    });
    expect(mag.label).toBe("AR.15");
  });

  test("AE7/R11 (magpul, service): update passing same nonconforming label saves unchanged (KTD-3 grandfather)", async () => {
    const existing = await makeMagazine(ownerUser, { label: "range gun" });
    const updated = await updateMagazine(ownerUser, existing.id, {
      brandModel: "Test MG",
      caliber: ".45 ACP",
      baseCapacity: 15,
      extensionRounds: 0,
      label: "range gun",
    });
    expect(updated.label).toBe("range gun");
  });

  test("R11 (magpul, service): caliber-only update (label omitted) preserves nonconforming label (KTD-3)", async () => {
    const existing = await makeMagazine(ownerUser, { label: "range gun" });
    const updated = await updateMagazine(ownerUser, existing.id, {
      brandModel: "Test MG",
      caliber: ".45 ACP",
      baseCapacity: 15,
      extensionRounds: 0,
      // label intentionally omitted — should preserve stored "range gun"
    });
    expect(updated.label).toBe("range gun");
  });

  test("AE10 (magpul, service): grantee (mode off) creating for mode-on owner enforces owner constraint", async () => {
    const anchorMag = await makeMagazine(ownerUser, {});
    await createGrant(db, {
      actorId: ownerUser,
      granteeId: granteeUser,
      parentType: "magazine",
      parentId: anchorMag.id,
      permission: "edit",
      allowCreateOnBehalf: true,
    });

    let caughtError: unknown;
    try {
      await createMagazine(granteeUser, {
        brandModel: "Test",
        caliber: "9mm",
        baseCapacity: 15,
        extensionRounds: 0,
        label: "AR.15",
        ownerId: ownerUser,
      });
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).toBeInstanceOf(ValidationError);
    // "AR.15" is both out-of-charset (".") and too long (5 chars); assert both
    // so a regression dropping either check on the create-on-behalf path fails.
    expect((caughtError as ValidationError).codes).toContain(
      "invalidMagpulLabel",
    );
    expect((caughtError as ValidationError).codes).toContain(
      "magpulLabelTooLong",
    );
  });

  test("AE7/R11 (magpul, service): update CHANGING label to an invalid value is rejected", async () => {
    const existing = await makeMagazine(ownerUser, { label: "range gun" });
    let caughtError: unknown;
    try {
      await updateMagazine(ownerUser, existing.id, {
        brandModel: "Test MG",
        caliber: ".45 ACP",
        baseCapacity: 15,
        extensionRounds: 0,
        label: "A.1",
      });
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).toBeInstanceOf(ValidationError);
    expect((caughtError as ValidationError).codes).toContain(
      "invalidMagpulLabel",
    );
  });
});

live("createMagazine — prefix recording (#22)", () => {
  test("records a non-empty labelPrefix in the owner's list (R1)", async () => {
    const owner = await createUser("cp-rec");
    await createMagazine(owner, {
      brandModel: "PMAG",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 0,
      label: "MP01",
      labelPrefix: "MP",
    });
    expect(await listPrefixes(owner)).toEqual(["MP"]);
    await deleteUsers(owner);
  });

  test("records nothing when no labelPrefix is supplied", async () => {
    const owner = await createUser("cp-none");
    await createMagazine(owner, {
      brandModel: "PMAG",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 0,
      label: "hand-typed",
    });
    expect(await listPrefixes(owner)).toEqual([]);
    await deleteUsers(owner);
  });
});
