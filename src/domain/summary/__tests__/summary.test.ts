import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMagazine } from "@/src/domain/magazines/service";
import {
  createUser,
  deleteUsers,
  makeAmmo,
  makeFirearm,
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
    // U5: computeSummary's return shape grew ammo roll-up fields — the
    // magazine/firearm fields it originally asserted stay 0/[]/[] (regression),
    // and the new ammo fields are asserted zero/empty too (never null, R68-style).
    expect(s).toEqual({
      totalMagazines: 0,
      byCaliber: [],
      firearmCounts: [],
      totalAmmoLots: 0,
      ammoEntriesLow: 0,
      ammoCalibersLow: 0,
      caliberCoverage: [],
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

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("inventorySummary (U7, viewer-relative)", () => {
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
    expect(aSummary.totalAmmoLots).toBeGreaterThanOrEqual(2);
    expect(aSummary.ammoEntriesLow).toBeGreaterThanOrEqual(1);
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
