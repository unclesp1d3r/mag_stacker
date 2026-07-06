import { describe, expect, test } from "bun:test";
import { buildGroups } from "../grouping";
import {
  type MagazineGroupRow,
  magazineByPrefixKey,
  magazineByTypeKey,
  magazineCapacityAggregate,
  magazineLabelAscending,
} from "../magazine-groups";

const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";

function magazine(overrides: Partial<MagazineGroupRow> = {}): MagazineGroupRow {
  return {
    ownerId: OWNER,
    label: "M001",
    brandModel: "PMAG",
    caliber: "5.56",
    baseCapacity: 30,
    extensionRounds: 0,
    ...overrides,
  };
}

describe("magazineByPrefixKey (R9)", () => {
  test("Covers AE1: longest recorded prefix wins", () => {
    const prefixes = ["AR", "AR15"];
    const m = magazine({ label: "AR15001" });

    const { key, name } = magazineByPrefixKey(m, prefixes);

    expect(key).toBe("AR15");
    expect(name).toBe("AR15");
  });

  test("Covers AE2: a label matching no recorded prefix is Unprefixed", () => {
    const prefixes = ["AR", "GL"];
    const m = magazine({ label: "PMAG-001" });

    const { key, name } = magazineByPrefixKey(m, prefixes);

    expect(key).toBe("__unprefixed__");
    expect(name).toBe("Unprefixed");
  });

  test("empty prefix list puts every magazine in Unprefixed", () => {
    const m = magazine({ label: "AR15001" });

    const { key, name } = magazineByPrefixKey(m, []);

    expect(key).toBe("__unprefixed__");
    expect(name).toBe("Unprefixed");
  });

  test("does not mutate the caller's prefixes array", () => {
    const prefixes = ["AR15", "AR"];
    const original = [...prefixes];

    magazineByPrefixKey(magazine({ label: "AR15001" }), prefixes);

    expect(prefixes).toEqual(original);
  });
});

describe("magazineByTypeKey (R8)", () => {
  test("Covers AE3/AE4: identical identity magazines share one key", () => {
    const a = magazine({ label: "A" });
    const b = magazine({ label: "B" });

    expect(magazineByTypeKey(a).key).toBe(magazineByTypeKey(b).key);
  });

  test("differing identity fields produce different keys", () => {
    const base = magazineByTypeKey(magazine()).key;
    const differentCaliber = magazineByTypeKey(
      magazine({ caliber: "9mm" }),
    ).key;
    const differentCapacity = magazineByTypeKey(
      magazine({ baseCapacity: 40 }),
    ).key;
    const differentExtension = magazineByTypeKey(
      magazine({ extensionRounds: 5 }),
    ).key;

    expect(differentCaliber).not.toBe(base);
    expect(differentCapacity).not.toBe(base);
    expect(differentExtension).not.toBe(base);
  });

  test("name is human-readable", () => {
    const { name } = magazineByTypeKey(magazine());

    expect(name.length).toBeGreaterThan(0);
    expect(name).toContain("PMAG");
  });
});

describe("magazineCapacityAggregate (R12)", () => {
  test("sums baseCapacity + extensionRounds across members", () => {
    const members = [
      magazine({ baseCapacity: 30, extensionRounds: 0 }),
      magazine({ baseCapacity: 30, extensionRounds: 5 }),
      magazine({ baseCapacity: 30, extensionRounds: 10 }),
    ];

    expect(magazineCapacityAggregate(members)).toBe(105);
  });

  test("empty members sums to zero", () => {
    expect(magazineCapacityAggregate([])).toBe(0);
  });
});

describe("magazineLabelAscending (default member sort, R13)", () => {
  test("orders members by label ascending", () => {
    const members = [
      magazine({ label: "C" }),
      magazine({ label: "A" }),
      magazine({ label: "B" }),
    ];

    const sorted = [...members].sort(magazineLabelAscending);

    expect(sorted.map((m) => m.label)).toEqual(["A", "B", "C"]);
  });
});

describe("buildGroups + magazine key selectors (integration of AE1-AE5)", () => {
  test("Covers AE3: 7 owned + 3 borrowed of the same identity", () => {
    const owned = Array.from({ length: 7 }, (_, i) =>
      magazine({ label: `M${i}`, ownerId: OWNER }),
    );
    const borrowed = Array.from({ length: 3 }, (_, i) =>
      magazine({ label: `X${i}`, ownerId: OTHER_OWNER }),
    );

    const { groups, borrowed: borrowedOut } = buildGroups(
      [...owned, ...borrowed],
      { ownerId: OWNER, keyOf: magazineByTypeKey },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(7);
    expect(borrowedOut).toHaveLength(3);
    expect(borrowedOut.every((m) => m.ownerId === OTHER_OWNER)).toBe(true);
  });

  test("Covers AE4: 10 identical owned magazines collapse into one group of 10", () => {
    const owned = Array.from({ length: 10 }, (_, i) =>
      magazine({ label: `M${i}` }),
    );

    const { groups } = buildGroups(owned, {
      ownerId: OWNER,
      keyOf: magazineByTypeKey,
      memberSort: magazineLabelAscending,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(10);
    expect(groups[0]?.members).toHaveLength(10);
    expect(groups[0]?.members.map((m) => m.label)).toEqual(
      Array.from({ length: 10 }, (_, i) => `M${i}`).sort(),
    );
  });

  test("Covers AE5: grouping over a pre-filtered subset only builds groups from what's passed", () => {
    const all = [
      magazine({ label: "A", caliber: "5.56" }),
      magazine({ label: "B", caliber: "9mm" }),
    ];
    const filtered = all.filter((m) => m.caliber === "5.56");

    const { groups } = buildGroups(filtered, {
      ownerId: OWNER,
      keyOf: magazineByTypeKey,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
  });

  test("capacity aggregate wired through buildGroups sums across members", () => {
    // Same identity (baseCapacity/extensionRounds included) so both land in
    // one group; the aggregate sums per-member capacity across the group.
    const owned = [
      magazine({ label: "A", baseCapacity: 30, extensionRounds: 5 }),
      magazine({ label: "B", baseCapacity: 30, extensionRounds: 5 }),
    ];

    const { groups } = buildGroups(owned, {
      ownerId: OWNER,
      keyOf: magazineByTypeKey,
      aggregateOf: magazineCapacityAggregate,
    });

    expect(groups[0]?.aggregate).toBe(70);
  });

  test("Covers AE1/AE2 through buildGroups: prefix grouping with longest-match and Unprefixed", () => {
    const prefixes = ["AR", "AR15"];
    const owned = [
      magazine({ label: "AR15001", ownerId: OWNER }),
      magazine({ label: "AR002", ownerId: OWNER }),
      magazine({ label: "ZZZ001", ownerId: OWNER }),
    ];

    const { groups } = buildGroups(owned, {
      ownerId: OWNER,
      keyOf: (m) => magazineByPrefixKey(m, prefixes),
    });

    const byName = Object.fromEntries(groups.map((g) => [g.name, g.count]));
    expect(byName.AR15).toBe(1);
    expect(byName.AR).toBe(1);
    expect(byName.Unprefixed).toBe(1);
  });
});
