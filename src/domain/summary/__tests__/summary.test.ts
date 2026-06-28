import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMagazine } from "@/src/domain/magazines/service";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import {
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
    expect(s).toEqual({ totalMagazines: 0, byCaliber: [], firearmCounts: [] });
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
});
