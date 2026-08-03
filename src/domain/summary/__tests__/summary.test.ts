import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { createMagazine } from "@/src/domain/magazines/service";
import {
  type ItemDueEntry,
  listDueForVisibleCollection,
  type RuleDueState,
} from "@/src/domain/service-intervals/due-service";
import {
  createItemRule,
  createServiceRuleDefault,
} from "@/src/domain/service-intervals/rules-service";
import {
  createUser,
  deleteUsers,
  makeAccessory,
  makeAmmo,
  makeFirearm,
  makeServiceEvent,
} from "@/src/test-support/factories";
import {
  type AmmoSnapshot,
  computeSummary,
  type FirearmIdentity,
  inventorySummary,
  type MagazineSnapshot,
} from "../summary";

function caliberRow(s: ReturnType<typeof computeSummary>, caliber: string) {
  return s.byCaliber.find((r) => r.caliber === caliber);
}
function firearmRow(s: ReturnType<typeof computeSummary>, id: string) {
  return s.firearmCounts.find((r) => r.id === id);
}

/** A minimal `RuleDueState` fixture — only `due` varies across these tests. */
function dueRule(name: string, due: boolean): RuleDueState {
  return {
    name,
    inheritanceState: "item-only",
    intervalDays: null,
    intervalSessions: null,
    intervalRounds: null,
    measureFrom: new Date(2026, 0, 1),
    counts: { days: 0, sessions: 0, rounds: 0 },
    due,
    trippedAxis: due ? "days" : null,
  };
}

function dueEntry(
  parentType: ItemDueEntry["parentType"],
  parentId: string,
  rules: RuleDueState[],
): ItemDueEntry {
  return { parentType, parentId, rules };
}

/**
 * Counts every SQL round trip issued through `pg`'s `Pool.prototype.query`
 * while `fn` runs — mirrors `due-service.test.ts`'s helper (U4), which proved
 * `listDueForVisibleCollection` is bounded; this proves `inventorySummary`
 * stays bounded when it threads that same call through (U9's Definition of
 * Done: "the summary loads without a per-item query as the visible set
 * grows").
 */
async function countPoolQueries<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; count: number }> {
  const original = Pool.prototype.query;
  let count = 0;
  Pool.prototype.query = function (
    this: Pool,
    ...args: Parameters<typeof original>
  ) {
    count += 1;
    // biome-ignore lint/suspicious/noExplicitAny: passthrough to the original overloaded pg method
    return (original as any).apply(this, args);
  } as typeof original;
  try {
    const result = await fn();
    return { result, count };
  } finally {
    Pool.prototype.query = original;
  }
}

// Pure aggregation — parity digest §12.3 (no DB).
describe("computeSummary (parity §7)", () => {
  test("covers AE2/AE7: the digest worked example", () => {
    const firearms: FirearmIdentity[] = [
      { id: "g", name: "Glock 19" },
      { id: "a", name: "AR-15" },
    ];
    const magazines: MagazineSnapshot[] = [
      {
        caliber: "9mm",
        baseCapacity: 15,
        extensionRounds: 2,
        compatibleFirearmIds: ["g"],
      },
      {
        caliber: "9mm",
        baseCapacity: 15,
        extensionRounds: 0,
        compatibleFirearmIds: ["g"],
      },
      {
        caliber: "5.56",
        baseCapacity: 30,
        extensionRounds: 0,
        compatibleFirearmIds: ["a"],
      },
    ];
    const s = computeSummary(firearms, magazines);
    expect(s.totalMagazines).toBe(3);
    expect(caliberRow(s, "9mm")).toEqual({
      caliber: "9mm",
      count: 2,
      effectiveCapacity: 32,
    });
    expect(caliberRow(s, "5.56")).toEqual({
      caliber: "5.56",
      count: 1,
      effectiveCapacity: 30,
    });
    expect(firearmRow(s, "g")?.count).toBe(2);
    expect(firearmRow(s, "a")?.count).toBe(1);
  });

  test("a firearm with zero compatible magazines appears with count 0 (R39)", () => {
    const s = computeSummary([{ id: "x", name: "Unused" }], []);
    expect(firearmRow(s, "x")?.count).toBe(0);
  });

  test("an orphaned link (firearm id not in snapshot) counts in totals but adds no per-firearm entry (R40)", () => {
    const s = computeSummary(
      [{ id: "g", name: "Glock 19" }],
      [
        {
          caliber: "9mm",
          baseCapacity: 10,
          extensionRounds: 0,
          compatibleFirearmIds: ["ghost"],
        },
      ],
    );
    expect(s.totalMagazines).toBe(1);
    expect(caliberRow(s, "9mm")?.count).toBe(1);
    expect(s.firearmCounts.find((r) => r.id === "ghost")).toBeUndefined();
    expect(firearmRow(s, "g")?.count).toBe(0);
  });

  test("covers AE7: two same-named firearms with distinct ids produce two entries", () => {
    const s = computeSummary(
      [
        { id: "1", name: "Glock 19" },
        { id: "2", name: "Glock 19" },
      ],
      [
        {
          caliber: "9mm",
          baseCapacity: 15,
          extensionRounds: 0,
          compatibleFirearmIds: ["1"],
        },
      ],
    );
    expect(s.firearmCounts).toHaveLength(2);
    expect(firearmRow(s, "1")?.count).toBe(1);
    expect(firearmRow(s, "2")?.count).toBe(0);
  });

  test("per-caliber sorts by caliber, per-firearm sorts by name (R42)", () => {
    const s = computeSummary(
      [
        { id: "z", name: "Zeta" },
        { id: "a", name: "Alpha" },
      ],
      [
        {
          caliber: "9mm",
          baseCapacity: 10,
          extensionRounds: 0,
          compatibleFirearmIds: [],
        },
        {
          caliber: "5.56",
          baseCapacity: 30,
          extensionRounds: 0,
          compatibleFirearmIds: [],
        },
      ],
    );
    expect(s.byCaliber.map((r) => r.caliber)).toEqual(["5.56", "9mm"]);
    expect(s.firearmCounts.map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });

  test("empty inventory yields zeros/empty arrays, never null (R68)", () => {
    const s = computeSummary([], []);
    // U5: computeSummary's return shape grew ammo roll-up fields, and U9 grew
    // it again with the service roll-up — the magazine/firearm fields it
    // originally asserted stay 0/[]/[] (regression), and every added field is
    // asserted zero/empty too (never null, R68-style).
    expect(s).toEqual({
      totalMagazines: 0,
      byCaliber: [],
      firearmCounts: [],
      totalAmmoLots: 0,
      ammoEntriesLow: 0,
      ammoCalibersLow: 0,
      caliberCoverage: [],
      itemsDue: 0,
      rulesDue: 0,
    });
  });
});

// Ammo roll-ups + caliber-coverage cross-reference (U5, R11/R12). Pure —
// mirrors the existing computeSummary describe block's style, no DB.
describe("computeSummary — ammo roll-ups (U5)", () => {
  test("mixed fixture: 3 low lots across 2 calibers → ammoEntriesLow == 3, ammoCalibersLow == 2 (R11/AE3)", () => {
    const ammo: AmmoSnapshot[] = [
      { caliber: "9mm", quantityRounds: 0, lowStockThreshold: 10 }, // low
      { caliber: "9mm", quantityRounds: 5, lowStockThreshold: 5 }, // low (boundary)
      { caliber: "5.56", quantityRounds: 2, lowStockThreshold: 20 }, // low
      { caliber: "5.56", quantityRounds: 200, lowStockThreshold: 20 }, // adequate
    ];
    const s = computeSummary([], [], ammo);
    expect(s.totalAmmoLots).toBe(4);
    expect(s.ammoEntriesLow).toBe(3);
    expect(s.ammoCalibersLow).toBe(2);
  });

  test("caliber coverage: zero lots → no-ammo, all-low lots → low-stock-only, ample lot → absent (R12/AE3)", () => {
    const firearms: FirearmIdentity[] = [
      { id: "f1", name: "No Ammo Gun", caliber: ".45 ACP" },
      { id: "f2", name: "All Low Gun", caliber: "5.56" },
      { id: "f3", name: "Ample Gun", caliber: "9mm" },
    ];
    const ammo: AmmoSnapshot[] = [
      { caliber: "5.56", quantityRounds: 1, lowStockThreshold: 20 },
      { caliber: "9mm", quantityRounds: 500, lowStockThreshold: 20 },
    ];
    const s = computeSummary(firearms, [], ammo);
    expect(s.caliberCoverage).toEqual([
      { caliber: ".45 ACP", reason: "no-ammo" },
      { caliber: "5.56", reason: "low-stock-only" },
    ]);
  });

  test("caliber matching is whitespace- and case-insensitive across entities (#52)", () => {
    const firearms: FirearmIdentity[] = [
      { id: "f1", name: "Spacey Gun", caliber: "9MM " }, // raw entry with case + trailing space
      { id: "f2", name: "Dup Gun", caliber: "9mm" }, // same caliber, different casing
      { id: "f3", name: "Uncovered Gun", caliber: ".45 ACP" },
    ];
    const ammo: AmmoSnapshot[] = [
      { caliber: "9mm", quantityRounds: 500, lowStockThreshold: 20 }, // adequate
      { caliber: " 9mm", quantityRounds: 0, lowStockThreshold: 10 }, // low, leading space
    ];
    const s = computeSummary(firearms, [], ammo);
    // The two 9mm variants are one caliber: not flagged (has an adequate lot),
    // and rendered as one row at most — only .45 ACP lacks ammo.
    expect(s.caliberCoverage).toEqual([
      { caliber: ".45 ACP", reason: "no-ammo" },
    ]);
    // The low " 9mm" lot still counts once toward the any-lot roll-up.
    expect(s.ammoEntriesLow).toBe(1);
    expect(s.ammoCalibersLow).toBe(1);
  });

  test("any-vs-all divergence: one low + one adequate lot of the same caliber counts in ammoCalibersLow (R11) but NOT in caliberCoverage (R12)", () => {
    const firearms: FirearmIdentity[] = [
      { id: "f1", name: "Divergent Gun", caliber: "9mm" },
    ];
    const ammo: AmmoSnapshot[] = [
      { caliber: "9mm", quantityRounds: 0, lowStockThreshold: 10 }, // low
      { caliber: "9mm", quantityRounds: 500, lowStockThreshold: 10 }, // adequate
    ];
    const s = computeSummary(firearms, [], ammo);
    expect(s.ammoCalibersLow).toBe(1);
    expect(s.caliberCoverage).toEqual([]);
  });

  test("empty ammo inventory yields zero counts and empty coverage, never null (edge)", () => {
    const s = computeSummary(
      [{ id: "f1", name: "Lonely Gun", caliber: "9mm" }],
      [],
      [],
    );
    expect(s.totalAmmoLots).toBe(0);
    expect(s.ammoEntriesLow).toBe(0);
    expect(s.ammoCalibersLow).toBe(0);
    expect(s.caliberCoverage).toEqual([{ caliber: "9mm", reason: "no-ammo" }]);
  });

  test("a firearm without a caliber (optional field, pre-ammo literal) contributes no coverage row — existing FirearmIdentity literals stay valid", () => {
    const s = computeSummary([{ id: "x", name: "No Caliber Gun" }], [], []);
    expect(s.caliberCoverage).toEqual([]);
  });

  test("magazine/firearm fields are unchanged by the ammo extension (regression)", () => {
    const firearms: FirearmIdentity[] = [{ id: "g", name: "Glock 19" }];
    const magazines: MagazineSnapshot[] = [
      {
        caliber: "9mm",
        baseCapacity: 15,
        extensionRounds: 2,
        compatibleFirearmIds: ["g"],
      },
    ];
    const ammo: AmmoSnapshot[] = [
      { caliber: "9mm", quantityRounds: 0, lowStockThreshold: 5 },
    ];
    const s = computeSummary(firearms, magazines, ammo);
    expect(s.totalMagazines).toBe(1);
    expect(caliberRow(s, "9mm")).toEqual({
      caliber: "9mm",
      count: 1,
      effectiveCapacity: 17,
    });
    expect(firearmRow(s, "g")?.count).toBe(1);
  });

  test("caliberCoverage is sorted alphabetically regardless of firearm input order", () => {
    const firearms: FirearmIdentity[] = [
      { id: "f1", name: "Z Gun", caliber: "9mm" },
      { id: "f2", name: "A Gun", caliber: ".45 ACP" },
      { id: "f3", name: "M Gun", caliber: "5.56" },
    ];
    // No ammo for any of them → all three appear, sorted by caliber.
    const s = computeSummary(firearms, [], []);
    expect(s.caliberCoverage.map((c) => c.caliber)).toEqual([
      ".45 ACP",
      "5.56",
      "9mm",
    ]);
  });
});

// Service due roll-up (service-intervals plan U9, R19). Pure — folds
// pre-computed `ItemDueEntry[]` fixtures (never re-derives due state itself,
// KTD4), mirroring the ammo roll-up block's style above.
describe("computeSummary — service roll-up (U9)", () => {
  test("covers R19: counts items with >=1 due rule (breadth) and due rules in total (volume) from one fold", () => {
    const entries: ItemDueEntry[] = [
      dueEntry("firearm", "f1", [
        dueRule("Cleaning", true),
        dueRule("Barrel", true),
      ]),
      dueEntry("firearm", "f2", [dueRule("Cleaning", false)]),
      dueEntry("accessory", "a1", [dueRule("Cleaning", true)]),
    ];
    const s = computeSummary([], [], [], entries);
    expect(s.itemsDue).toBe(2);
    expect(s.rulesDue).toBe(3);
  });

  test("an item with no due rules contributes to neither count", () => {
    const entries: ItemDueEntry[] = [
      dueEntry("firearm", "f1", [
        dueRule("Cleaning", false),
        dueRule("Barrel", false),
      ]),
    ];
    const s = computeSummary([], [], [], entries);
    expect(s.itemsDue).toBe(0);
    expect(s.rulesDue).toBe(0);
  });

  test("no dueEntries argument yields a zero roll-up, not an error (default param)", () => {
    const s = computeSummary([], []);
    expect(s.itemsDue).toBe(0);
    expect(s.rulesDue).toBe(0);
  });

  test("an empty entries array (no visible items) yields a zero roll-up", () => {
    const s = computeSummary([], [], [], []);
    expect(s.itemsDue).toBe(0);
    expect(s.rulesDue).toBe(0);
  });
});

describe("inventorySummary (U7, viewer-relative)", () => {
  let userA = "";
  let userB = "";
  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("computed only over owned+shared; A's unshared magazines never affect B's summary (R41)", async () => {
    const fa = await makeFirearm(userA, { name: "A FA" });
    await createMagazine(userA, {
      brandModel: "A mag",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 2,
      compatibleFirearmIds: [fa.id],
    });
    const aSummary = await inventorySummary(userA);
    expect(aSummary.totalMagazines).toBeGreaterThanOrEqual(1);

    const bSummary = await inventorySummary(userB);
    expect(bSummary.totalMagazines).toBe(0);
    expect(bSummary.byCaliber).toEqual([]);
    expect(bSummary.firearmCounts).toEqual([]);
  });

  test("U5: inventorySummary threads listAmmo + firearm caliber into computeSummary (covers AE3 integration leg)", async () => {
    await makeFirearm(userA, { name: "A Rifle", caliber: "5.56" });
    await makeAmmo(userA, {
      caliber: "5.56",
      quantityRounds: 1,
      lowStockThreshold: 20,
    });
    await makeAmmo(userA, {
      caliber: "9mm",
      quantityRounds: 500,
      lowStockThreshold: 20,
    });

    const aSummary = await inventorySummary(userA);
    // userA is fresh to this file with exactly the two lots seeded above — one
    // low (5.56 at 1/20), one adequate (9mm at 500/20) — so assert exact totals.
    expect(aSummary.totalAmmoLots).toBe(2);
    expect(aSummary.ammoEntriesLow).toBe(1);
    expect(
      aSummary.caliberCoverage.some(
        (row) => row.caliber === "5.56" && row.reason === "low-stock-only",
      ),
    ).toBe(true);

    const bSummary = await inventorySummary(userB);
    expect(bSummary.totalAmmoLots).toBe(0);
    expect(bSummary.ammoEntriesLow).toBe(0);
    expect(bSummary.ammoCalibersLow).toBe(0);
    expect(bSummary.caliberCoverage).toEqual([]);
  });
});

/**
 * `inventorySummary`'s service roll-up, end to end (service-intervals plan
 * U9, R19/R20/R21). Each test creates its own isolated owner(s) (mirrors
 * `due-service.test.ts`'s isolation style) rather than sharing the userA/userB
 * pair above, so ordering never matters. A firearm's `acquiredDate` is always
 * set far in the past with a 1-day threshold — due regardless of the actual
 * run date, with no need to pin `asOf` (`inventorySummary` doesn't expose one).
 */
describe("inventorySummary — service roll-up (U9)", () => {
  const createdUsers: string[] = [];

  afterAll(async () => {
    await deleteUsers(...createdUsers);
  });

  async function newOwner(label: string): Promise<string> {
    const id = await createUser(label);
    createdUsers.push(id);
    return id;
  }

  const LONG_AGO = "2020-01-01";
  const OVERDUE = { intervalDays: 1 };

  test("covers AE5: a suppressed rule that would otherwise be due contributes to neither count", async () => {
    const owner = await newOwner("u9ae5");
    const fa = await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: LONG_AGO,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      ...OVERDUE,
    });
    await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      suppressed: true,
    });

    const summary = await inventorySummary(owner);
    expect(summary.itemsDue).toBe(0);
    expect(summary.rulesDue).toBe(0);
  });

  test("covers R19: three items due across five rules — breadth and volume both visible", async () => {
    const owner = await newOwner("u9r19");

    await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: LONG_AGO,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      ...OVERDUE,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Barrel",
      ...OVERDUE,
    });

    await makeFirearm(owner, {
      type: "pistol",
      acquiredDate: LONG_AGO,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "pistol",
      name: "Cleaning",
      ...OVERDUE,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "pistol",
      name: "Recoil spring",
      ...OVERDUE,
    });

    const optic = await makeAccessory(owner, { category: "Optic" });
    await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Optic",
      name: "Zero check",
      ...OVERDUE,
    });
    // Accessories have no acquired date (KTD9) — their origin is `createdAt`,
    // which is "now" for a freshly-inserted row, so a 1-day threshold alone
    // would never trip. A backdated service event gives the rule an old
    // measure-from point instead, same as a real owner's history would.
    await makeServiceEvent(
      { accessoryId: optic.id },
      { ruleName: "Zero check", servicedOn: LONG_AGO },
    );

    const summary = await inventorySummary(owner);
    expect(summary.itemsDue).toBe(3);
    expect(summary.rulesDue).toBe(5);
  });

  test("a shared firearm that is due appears in the grantee's roll-up, using its owner's defaults", async () => {
    const owner = await newOwner("u9shareOwner");
    const grantee = await newOwner("u9shareGrantee");
    const fa = await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: LONG_AGO,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      ...OVERDUE,
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });

    const summary = await inventorySummary(grantee);
    expect(summary.itemsDue).toBe(1);
    expect(summary.rulesDue).toBe(1);
  });

  test("an item due only because of an accessory mounted to it is not itself marked — the accessory's own entry carries the due rule", async () => {
    const owner = await newOwner("u9accessoryOnly");
    const fa = await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: LONG_AGO,
    });
    // No default/rule ever tracks the firearm itself.
    const suppressor = await makeAccessory(owner, {
      category: "Suppressor",
      currentFirearmId: fa.id,
    });
    await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Suppressor",
      name: "Cleaning",
      ...OVERDUE,
    });
    // Accessory origin is `createdAt` (KTD9) — backdate a service event so
    // the 1-day threshold actually trips (see the R19 test above).
    await makeServiceEvent(
      { accessoryId: suppressor.id },
      { ruleName: "Cleaning", servicedOn: LONG_AGO },
    );

    const summary = await inventorySummary(owner);
    expect(summary.itemsDue).toBe(1);
    expect(summary.rulesDue).toBe(1);

    // The firearm has no effective rules of its own, so it's absent from
    // `listDueForVisibleCollection`'s output entirely — never marked due on
    // the accessory's account.
    const dueEntries = await listDueForVisibleCollection(owner);
    const firearmEntry = dueEntries.find(
      (entry) => entry.parentType === "firearm" && entry.parentId === fa.id,
    );
    expect(firearmEntry).toBeUndefined();
  });

  test("an owner with no defaults configured anywhere sees a zero roll-up, not an empty-state error", async () => {
    const owner = await newOwner("u9zero");
    await makeFirearm(owner, { type: "rifle" }); // an item exists; nothing tracks it
    const summary = await inventorySummary(owner);
    expect(summary.itemsDue).toBe(0);
    expect(summary.rulesDue).toBe(0);
  });

  test("inventorySummary's service roll-up loads in a bounded number of queries as the visible set grows (KTD4)", async () => {
    const owner = await newOwner("u9bounded");
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      ...OVERDUE,
    });

    async function addRifles(n: number): Promise<void> {
      for (let i = 0; i < n; i += 1) {
        await makeFirearm(owner, {
          type: "rifle",
          name: `Rifle ${i}`,
          acquiredDate: LONG_AGO,
        });
      }
    }

    await addRifles(2);
    const { result: small, count: smallCount } = await countPoolQueries(() =>
      inventorySummary(owner),
    );
    expect(small.itemsDue).toBe(2);

    await addRifles(8); // 10 firearms total now
    const { result: large, count: largeCount } = await countPoolQueries(() =>
      inventorySummary(owner),
    );
    expect(large.itemsDue).toBe(10);

    // Same bounded query count regardless of collection size (Definition of
    // Done, U9/U4) — never a per-item query.
    expect(largeCount).toBe(smallCount);
  });
});
