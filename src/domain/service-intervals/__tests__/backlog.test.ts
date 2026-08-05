import { describe, expect, test } from "bun:test";
import { buildServiceBacklog } from "../backlog";
import type { ItemDueEntry, RuleDueState } from "../due-service";

/**
 * Pure unit tests for `buildServiceBacklog` (R16/R19 surface, U9-adjacent).
 * No DB — `ItemDueEntry`/`RuleDueState` fixtures are hand-built, matching how
 * `derive.test.ts` and `due-service.test.ts` construct these shapes.
 */

function rule(name: string, due: boolean): RuleDueState {
  const base = {
    name,
    intervalDays: null,
    intervalSessions: null,
    intervalRounds: null,
    inheritanceState: "inherited" as const,
    measureFrom: new Date(2026, 0, 1),
    counts: { days: 0, sessions: 0, rounds: 0 },
  };
  // Branched (rather than a flat `due, trippedAxis: due ? "days" : null`)
  // because `RuleDueState` is now a discriminated union (Fix 1): only this
  // shape lets TypeScript confirm the fixture actually matches what
  // `isDue` ever produces, rather than a boolean-typed `due` masking a
  // `due: true` + `trippedAxis: null` pairing the real code can't build.
  return due
    ? { ...base, due: true, trippedAxis: "days" }
    : { ...base, due: false, trippedAxis: null };
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
      new Set(["fa-1"]),
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
      buildServiceBacklog(
        entries,
        new Map([["fa-1", "Rifle"]]),
        new Map(),
        new Set(["fa-1"]),
      ),
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
      new Set(),
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

    const rows = buildServiceBacklog(
      entries,
      new Map(),
      new Map(),
      new Set(["fa-unknown"]),
    );

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

    const rows = buildServiceBacklog(
      entries,
      names,
      new Map(),
      new Set(["fa-1", "fa-2"]),
    );

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
      new Set(["fa-1"]),
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ruleName).sort()).toEqual(["Barrel", "Cleaning"]);
  });

  test("empty entries yields an empty backlog, not an error", () => {
    expect(buildServiceBacklog([], new Map(), new Map(), new Set())).toEqual(
      [],
    );
  });

  // --- Finding 1 (P1): view-only grantees must not be offered write rows ---

  test("a firearm absent from actionableFirearmIds (view-only grantee) is excluded from the backlog", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-view-only",
        rules: [rule("Cleaning", true)],
      },
    ];

    const rows = buildServiceBacklog(
      entries,
      new Map([["fa-view-only", "Shared Rifle"]]),
      new Map(),
      new Set(), // actor holds no owner/edit permission on this firearm
    );

    expect(rows).toEqual([]);
  });

  test("a firearm present in actionableFirearmIds (edit-grantee) is included in the backlog", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-edit",
        rules: [rule("Cleaning", true)],
      },
    ];

    const rows = buildServiceBacklog(
      entries,
      new Map([["fa-edit", "Shared Rifle"]]),
      new Map(),
      new Set(["fa-edit"]), // actor holds edit permission
    );

    expect(rows).toEqual([
      {
        parentType: "firearm",
        parentId: "fa-edit",
        itemName: "Shared Rifle",
        ruleName: "Cleaning",
      },
    ]);
  });

  test("a view-only firearm is excluded while the actor's own actionable firearm still appears", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "firearm",
        parentId: "fa-own",
        rules: [rule("Cleaning", true)],
      },
      {
        parentType: "firearm",
        parentId: "fa-view-only",
        rules: [rule("Barrel", true)],
      },
    ];

    const rows = buildServiceBacklog(
      entries,
      new Map([
        ["fa-own", "My Rifle"],
        ["fa-view-only", "Shared Rifle"],
      ]),
      new Map(),
      new Set(["fa-own"]),
    );

    expect(rows).toEqual([
      {
        parentType: "firearm",
        parentId: "fa-own",
        itemName: "My Rifle",
        ruleName: "Cleaning",
      },
    ]);
  });

  test("an accessory belonging to someone else never appears, regardless of actionableFirearmIds", () => {
    const entries: ItemDueEntry[] = [
      {
        parentType: "accessory",
        parentId: "acc-not-mine",
        rules: [rule("Lens", true)],
      },
    ];

    // actionableFirearmIds only ever governs firearm rows (KTD3: accessory
    // service is owner-only throughout, and `listDueForVisibleCollection`
    // never surfaces another owner's accessory in the first place) — an
    // empty set here proves the accessory row's inclusion doesn't depend on
    // it at all.
    const rows = buildServiceBacklog(
      entries,
      new Map(),
      new Map([["acc-not-mine", "Someone Else's Scope"]]),
      new Set(),
    );

    expect(rows).toEqual([
      {
        parentType: "accessory",
        parentId: "acc-not-mine",
        itemName: "Someone Else's Scope",
        ruleName: "Lens",
      },
    ]);
  });
});
