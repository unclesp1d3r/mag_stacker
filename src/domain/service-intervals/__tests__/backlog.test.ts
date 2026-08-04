import { describe, expect, test } from "bun:test";
import { buildServiceBacklog } from "../backlog";
import type { ItemDueEntry, RuleDueState } from "../due-service";

/**
 * Pure unit tests for `buildServiceBacklog` (R16/R19 surface, U9-adjacent).
 * No DB — `ItemDueEntry`/`RuleDueState` fixtures are hand-built, matching how
 * `derive.test.ts` and `due-service.test.ts` construct these shapes.
 */

function rule(name: string, due: boolean): RuleDueState {
  return {
    name,
    intervalDays: null,
    intervalSessions: null,
    intervalRounds: null,
    inheritanceState: "inherited",
    measureFrom: new Date(2026, 0, 1),
    counts: { days: 0, sessions: 0, rounds: 0 },
    due,
    trippedAxis: due ? "days" : null,
  };
}

describe("buildServiceBacklog", () => {
  test("one row per DUE rule, naming the item and the rule", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-1",
        rules: [rule("Cleaning", true), rule("Barrel", false)],
      },
    ];

    const rows = buildServiceBacklog(
      entries,
      new Map([["fa-1", "Interval Rifle One"]]),
      new Map(),
    );

    expect(rows).toEqual([
      {
        parentType: "firearm",
        parentId: "fa-1",
        itemName: "Interval Rifle One",
        ruleName: "Cleaning",
      },
    ]);
  });

  test("skips items with no due rules entirely", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-1",
        rules: [rule("Cleaning", false)],
      },
    ];

    expect(
      buildServiceBacklog(entries, new Map([["fa-1", "Rifle"]]), new Map()),
    ).toEqual([]);
  });

  test("covers accessories via the accessory name map, independent of firearm names", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "accessory",
        parentId: "acc-1",
        rules: [rule("Lens", true)],
      },
    ];

    const rows = buildServiceBacklog(
      entries,
      new Map(),
      new Map([["acc-1", "Vortex Scope"]]),
    );

    expect(rows).toEqual([
      {
        parentType: "accessory",
        parentId: "acc-1",
        itemName: "Vortex Scope",
        ruleName: "Lens",
      },
    ]);
  });

  test("an item missing from its name map falls back to a generic label rather than throwing", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-unknown",
        rules: [rule("Cleaning", true)],
      },
    ];

    const rows = buildServiceBacklog(entries, new Map(), new Map());

    expect(rows[0]?.itemName).toBe("Unknown item");
  });

  test("sorts rows by item name, then by rule name, for a stable display order", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-2",
        rules: [rule("Cleaning", true), rule("Barrel", true)],
      },
      {
        parentType: "firearm",
        parentId: "fa-1",
        rules: [rule("Cleaning", true)],
      },
    ];
    const names = new Map([
      ["fa-1", "Alpha Rifle"],
      ["fa-2", "Beta Rifle"],
    ]);

    const rows = buildServiceBacklog(entries, names, new Map());

    expect(rows.map((r) => `${r.itemName}:${r.ruleName}`)).toEqual([
      "Alpha Rifle:Cleaning",
      "Beta Rifle:Barrel",
      "Beta Rifle:Cleaning",
    ]);
  });

  test("multiple due rules on the same item each produce their own row", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-1",
        rules: [
          rule("Cleaning", true),
          rule("Barrel", true),
          rule("Recoil spring", false),
        ],
      },
    ];

    const rows = buildServiceBacklog(
      entries,
      new Map([["fa-1", "Rifle"]]),
      new Map(),
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ruleName).sort()).toEqual(["Barrel", "Cleaning"]);
  });

  test("empty entries yields an empty backlog, not an error", () => {
    expect(buildServiceBacklog([], new Map(), new Map())).toEqual([]);
  });
});
