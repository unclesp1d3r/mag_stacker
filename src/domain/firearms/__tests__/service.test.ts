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
import { firearmDisplayName } from "../display";
import {
  createFirearm,
  deleteFirearm,
  getFirearm,
  listFirearms,
  updateFirearm,
} from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

// A valid real classification, spread into create/update calls so the pre-
// taxonomy assertions keep testing what they always tested (U4 made type/action
// required on the create/update input).
const CLASS = { type: "pistol", action: "semi-auto" } as const;

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
      createFirearm(userA, { name: "", caliber: "", ...CLASS }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listFirearms(userA);
    expect(after.length).toBe(before.length);
  });

  test("create assigns ownership to the acting user (R8)", async () => {
    const fa = await createFirearm(userA, {
      name: "Glock 19",
      caliber: "9mm",
      ...CLASS,
    });
    expect(fa.ownerId).toBe(userA);
    expect(fa.manufacturer).toBe("");
    expect(fa.notes).toBe("");
  });

  test("a non-empty value with surrounding whitespace persists verbatim (R19)", async () => {
    const fa = await createFirearm(userA, {
      name: "  Spacey  ",
      caliber: " 9mm ",
      ...CLASS,
    });
    expect(fa.name).toBe("  Spacey  ");
    expect(fa.caliber).toBe(" 9mm ");
  });

  test("list returns owned+shared ordered by name ascending; empty is [] (R22/R68)", async () => {
    const empty = await listFirearms(userB);
    expect(empty).toEqual([]);

    await createFirearm(userA, { name: "Zeta", caliber: "9mm", ...CLASS });
    await createFirearm(userA, { name: "Alpha", caliber: "9mm", ...CLASS });
    const list = await listFirearms(userA);
    const names = list.map((f) => f.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);

    // A firearm shared to B shows up in B's list.
    const shared = await createFirearm(userA, {
      name: "Shared",
      caliber: "9mm",
      ...CLASS,
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
      ...CLASS,
    });
    const updated = await updateFirearm(userA, fa.id, {
      name: "Clearable",
      caliber: "9mm",
      ...CLASS,
    });
    expect(updated.manufacturer).toBe("");
    expect(updated.notes).toBe("");
  });

  test("deleting a firearm referenced by magazines succeeds; magazines survive with it dropped (R23)", async () => {
    const fa = await createFirearm(userA, {
      name: "Linked",
      caliber: "9mm",
      ...CLASS,
    });
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
    const fa = await createFirearm(userA, {
      name: "Private",
      caliber: "9mm",
      ...CLASS,
    });
    await expect(getFirearm(userB, fa.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// Taxonomy persistence (U4, R3/R6/R7/R12).
live("firearms service — taxonomy (U4)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    userA = await createUser("TaxA");
    userB = await createUser("TaxB");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("covers AE2: create with unspecified type/action throws and writes no row", async () => {
    const before = await listFirearms(userA);
    await expect(
      createFirearm(userA, {
        name: "Unclassified",
        caliber: "9mm",
        type: "unspecified",
        action: "unspecified",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listFirearms(userA);
    expect(after.length).toBe(before.length);
  });

  test("create persists real type/action and subtype verbatim; omitted subtype is ''", async () => {
    const withSubtype = await createFirearm(userA, {
      name: "Carbine",
      caliber: "9mm",
      type: "pcc",
      action: "semi-auto",
      subtype: "  Roland Special  ",
    });
    expect(withSubtype.type).toBe("pcc");
    expect(withSubtype.action).toBe("semi-auto");
    expect(withSubtype.subtype).toBe("  Roland Special  ");

    const noSubtype = await createFirearm(userA, {
      name: "Plain",
      caliber: "9mm",
      ...CLASS,
    });
    expect(noSubtype.subtype).toBe("");
  });

  test("covers AE3: out-of-set type throws in the domain and is rejected by the DB constraint", async () => {
    await expect(
      createFirearm(userA, {
        name: "Bad",
        caliber: "9mm",
        type: "blaster",
        action: "semi-auto",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Bypass the domain layer: the check constraints are the backstop (R4) —
    // one per column (firearm_type_valid / firearm_action_valid).
    await expectRejects(() =>
      db.insert(firearm).values({
        ownerId: userA,
        name: "RawBadType",
        caliber: "9mm",
        type: "blaster",
      }),
    );
    await expectRejects(() =>
      db.insert(firearm).values({
        ownerId: userA,
        name: "RawBadAction",
        caliber: "9mm",
        action: "phaser",
      }),
    );
  });

  test("covers AE5: a row created with column defaults reads back unspecified/'' and is valid", async () => {
    // Insert bypassing the service, using only non-default fields — this is the
    // shape a pre-feature (backfilled) row has after the migration's defaults.
    const [row] = await db
      .insert(firearm)
      .values({ ownerId: userA, name: "Legacy", caliber: "9mm" })
      .returning();
    expect(row.type).toBe("unspecified");
    expect(row.action).toBe("unspecified");
    expect(row.subtype).toBe("");
  });

  test("covers AE1: editing a backfilled row without choosing a real type/action throws", async () => {
    const [legacy] = await db
      .insert(firearm)
      .values({ ownerId: userA, name: "NeedsClass", caliber: "9mm" })
      .returning();

    // Saving the still-unspecified row is rejected (required-on-edit, R7).
    await expect(
      updateFirearm(userA, legacy.id, {
        name: "NeedsClass",
        caliber: "9mm",
        type: "unspecified",
        action: "unspecified",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Supplying a real classification succeeds.
    const fixed = await updateFirearm(userA, legacy.id, {
      name: "NeedsClass",
      caliber: "9mm",
      type: "rifle",
      action: "bolt",
    });
    expect(fixed.type).toBe("rifle");
    expect(fixed.action).toBe("bolt");
  });

  test("owner-scoping unchanged: a non-owner cannot update another owner's firearm", async () => {
    const fa = await createFirearm(userA, {
      name: "OwnedByA",
      caliber: "9mm",
      ...CLASS,
    });
    await expect(
      updateFirearm(userB, fa.id, {
        name: "Hijacked",
        caliber: "9mm",
        ...CLASS,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// Nickname persistence + displayed-label sort (#18).
live("firearms service — nickname (#18)", () => {
  let userN = "";

  beforeAll(async () => {
    userN = await createUser("NickN");
  });
  afterAll(async () => {
    await deleteUsers(userN);
  });

  test("create persists a nickname verbatim; omitted nickname is ''", async () => {
    const withNick = await createFirearm(userN, {
      name: "Glock 19 Gen 5",
      nickname: "Nightstand gun",
      caliber: "9mm",
      ...CLASS,
    });
    expect(withNick.nickname).toBe("Nightstand gun");
    const noNick = await createFirearm(userN, {
      name: "M&P Shield Plus",
      caliber: "9mm",
      ...CLASS,
    });
    expect(noNick.nickname).toBe("");
    await deleteFirearm(userN, withNick.id);
    await deleteFirearm(userN, noNick.id);
  });

  test("update can add, change, and clear the nickname", async () => {
    const fa = await createFirearm(userN, {
      name: "SIG P320",
      caliber: "9mm",
      ...CLASS,
    });
    const added = await updateFirearm(userN, fa.id, {
      name: "SIG P320",
      nickname: "Old Reliable",
      caliber: "9mm",
      ...CLASS,
    });
    expect(added.nickname).toBe("Old Reliable");
    const cleared = await updateFirearm(userN, fa.id, {
      name: "SIG P320",
      nickname: "",
      caliber: "9mm",
      ...CLASS,
    });
    expect(cleared.nickname).toBe("");
    await deleteFirearm(userN, fa.id);
  });

  test("covers AE2: listFirearms orders by the displayed label (nickname-or-name)", async () => {
    const created = await Promise.all([
      createFirearm(userN, {
        name: "Glock 19 Gen 5",
        nickname: "Nightstand gun",
        caliber: "9mm",
        ...CLASS,
      }),
      createFirearm(userN, {
        name: "M&P Shield Plus",
        caliber: "9mm",
        ...CLASS,
      }),
      createFirearm(userN, {
        name: "SIG P320",
        nickname: "Old Reliable",
        caliber: "9mm",
        ...CLASS,
      }),
      createFirearm(userN, {
        name: "Zulu Product",
        nickname: "   ",
        caliber: "9mm",
        ...CLASS,
      }),
    ]);
    const list = await listFirearms(userN);
    // Order tracks the shown label, not the underlying field: "M&P…" (product
    // name) sorts before "Nightstand gun" (a nickname on a "Glock…" row), and
    // the whitespace-only nickname falls back to its product name "Zulu Product".
    expect(list.map((f) => firearmDisplayName(f))).toEqual([
      "M&P Shield Plus",
      "Nightstand gun",
      "Old Reliable",
      "Zulu Product",
    ]);
    for (const f of created) await deleteFirearm(userN, f.id);
  });
});
