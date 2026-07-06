import { describe, expect, test } from "bun:test";
import { type FirearmGroupRow, firearmByTypeKey } from "../firearm-groups";
import { buildGroups } from "../grouping";

const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";

function firearm(overrides: Partial<FirearmGroupRow> = {}): FirearmGroupRow {
  return { ownerId: OWNER, type: "pistol", ...overrides };
}

describe("firearmByTypeKey (R7)", () => {
  test("key is the raw type; name is the friendly label", () => {
    const { key, name } = firearmByTypeKey(firearm({ type: "pcc" }));

    expect(key).toBe("pcc");
    expect(name).toBe("PCC");
  });
});

describe("buildGroups + firearmByTypeKey (R7, R10, R13, KTD-6)", () => {
  test("pistol x3, rifle x5 order rifle(5) then pistol(3)", () => {
    const pistols = Array.from({ length: 3 }, () =>
      firearm({ type: "pistol" }),
    );
    const rifles = Array.from({ length: 5 }, () => firearm({ type: "rifle" }));

    const { groups } = buildGroups([...pistols, ...rifles], {
      ownerId: OWNER,
      keyOf: firearmByTypeKey,
    });

    expect(groups.map((g) => ({ name: g.name, count: g.count }))).toEqual([
      { name: "Rifle", count: 5 },
      { name: "Pistol", count: 3 },
    ]);
  });

  test("a borrowed firearm is excluded from groups and returned in borrowed (R10)", () => {
    const owned = [firearm({ type: "pistol" }), firearm({ type: "pistol" })];
    const borrowedFirearm = firearm({ type: "pistol", ownerId: OTHER_OWNER });

    const { groups, borrowed } = buildGroups([...owned, borrowedFirearm], {
      ownerId: OWNER,
      keyOf: firearmByTypeKey,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(2);
    expect(borrowed).toEqual([borrowedFirearm]);
  });

  test("aggregate is undefined — count-only headers (KTD-6)", () => {
    const { groups } = buildGroups([firearm()], {
      ownerId: OWNER,
      keyOf: firearmByTypeKey,
    });

    expect(groups[0]?.aggregate).toBeUndefined();
  });
});
