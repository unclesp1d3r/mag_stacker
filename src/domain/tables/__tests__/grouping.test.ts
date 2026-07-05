import { describe, expect, test } from "bun:test";
import { buildGroups } from "../grouping";

// Fixture row used to exercise the generic engine without any magazine/firearm
// domain knowledge. `label` stands in for whatever display field a real
// caller sorts members by.
interface TestRow {
  ownerId: string;
  id: string;
  label: string;
  kind: "alpha" | "bravo" | "charlie";
}

const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";

function row(
  kind: TestRow["kind"],
  id: string,
  label: string,
  ownerId = OWNER,
): TestRow {
  return { ownerId, id, label, kind };
}

const keyOf = (r: TestRow) => ({
  key: r.kind,
  name: r.kind[0].toUpperCase() + r.kind.slice(1),
});

describe("buildGroups — group ordering (R13)", () => {
  test("counts 3, 7, 3 order as 7 then the two 3s by name ascending", () => {
    const rows: TestRow[] = [
      ...["a1", "a2", "a3"].map((id) => row("alpha", id, id)),
      ...["b1", "b2", "b3", "b4", "b5", "b6", "b7"].map((id) =>
        row("bravo", id, id),
      ),
      ...["c1", "c2", "c3"].map((id) => row("charlie", id, id)),
    ];

    const { groups } = buildGroups(rows, { ownerId: OWNER, keyOf });

    expect(groups.map((g) => g.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(groups.map((g) => g.count)).toEqual([7, 3, 3]);
  });
});

describe("buildGroups — member ordering (R13)", () => {
  test("no memberSort keeps members in the order they were supplied (default)", () => {
    // Rows already arrive in label-ascending order; with no memberSort the
    // engine preserves that order rather than re-sorting.
    const rows: TestRow[] = [
      row("alpha", "1", "B"),
      row("alpha", "2", "A"),
      row("alpha", "3", "C"),
    ];

    const { groups } = buildGroups(rows, { ownerId: OWNER, keyOf });

    expect(groups[0]?.members.map((m) => m.label)).toEqual(["B", "A", "C"]);
  });

  test("a supplied memberSort overrides the default order", () => {
    const rows: TestRow[] = [
      row("alpha", "1", "B"),
      row("alpha", "2", "A"),
      row("alpha", "3", "C"),
    ];

    const { groups } = buildGroups(rows, {
      ownerId: OWNER,
      keyOf,
      memberSort: (a, b) => a.label.localeCompare(b.label),
    });

    expect(groups[0]?.members.map((m) => m.label)).toEqual(["A", "B", "C"]);
  });
});

describe("buildGroups — empty inputs", () => {
  test("empty owned set yields zero groups", () => {
    const rows: TestRow[] = [row("alpha", "1", "A", OTHER_OWNER)];

    const { groups, borrowed } = buildGroups(rows, { ownerId: OWNER, keyOf });

    expect(groups).toEqual([]);
    expect(borrowed).toHaveLength(1);
  });

  test("empty borrowed set yields an empty borrowed array", () => {
    const rows: TestRow[] = [row("alpha", "1", "A", OWNER)];

    const { borrowed } = buildGroups(rows, { ownerId: OWNER, keyOf });

    expect(borrowed).toEqual([]);
  });

  test("empty rows yields zero groups and empty borrowed", () => {
    const { groups, borrowed } = buildGroups([], { ownerId: OWNER, keyOf });

    expect(groups).toEqual([]);
    expect(borrowed).toEqual([]);
  });
});

describe("buildGroups — aggregate", () => {
  test("aggregateOf receives the group's ordered members", () => {
    const rows: TestRow[] = [row("alpha", "1", "A"), row("alpha", "2", "B")];

    const { groups } = buildGroups(rows, {
      ownerId: OWNER,
      keyOf,
      aggregateOf: (members) => members.length * 10,
    });

    expect(groups[0]?.aggregate).toBe(20);
  });

  test("omitting aggregateOf leaves aggregate undefined", () => {
    const rows: TestRow[] = [row("alpha", "1", "A")];

    const { groups } = buildGroups(rows, { ownerId: OWNER, keyOf });

    expect(groups[0]?.aggregate).toBeUndefined();
  });
});

describe("buildGroups — immutability", () => {
  test("does not mutate the input rows array or its element order", () => {
    const rows: TestRow[] = [
      row("bravo", "1", "Z"),
      row("alpha", "2", "Y"),
      row("charlie", "3", "X"),
    ];
    const original = [...rows];

    buildGroups(rows, {
      ownerId: OWNER,
      keyOf,
      memberSort: (a, b) => a.label.localeCompare(b.label),
    });

    expect(rows).toEqual(original);
    expect(rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("buildGroups — pre-filtered input (R14/AE5)", () => {
  test("only builds groups from the rows it is given", () => {
    const rows: TestRow[] = [row("alpha", "1", "A"), row("bravo", "2", "B")];
    // Simulate the caller having already filtered out "charlie" rows.
    const filtered = rows.filter((r) => r.kind !== "charlie");

    const { groups } = buildGroups(filtered, { ownerId: OWNER, keyOf });

    expect(groups.map((g) => g.name).sort()).toEqual(["Alpha", "Bravo"]);
  });
});
