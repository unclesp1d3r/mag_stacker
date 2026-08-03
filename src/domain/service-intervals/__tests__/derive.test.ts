import { describe, expect, test } from "bun:test";
import {
  type DefaultRule,
  type ElapsedCounts,
  elapsedCounts,
  type ItemRule,
  isDue,
  resolveEffectiveRules,
  type SessionRow,
  type Thresholds,
} from "../derive";

// Pure derivation core (U2) — no DB. Date fixtures are always built with
// `new Date(y, monthIndex, d)` (local frame), never UTC `...Z` literals, per
// docs/solutions/test-failures/timezone-fragile-date-boundary-tests.md and
// KTD5. This file is run under UTC, TZ=Asia/Tokyo, and TZ=America/New_York.

function localDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

describe("resolveEffectiveRules", () => {
  test("covers AE1: inheritance survives an unrelated override", () => {
    const defaults: DefaultRule[] = [
      {
        name: "Cleaning",
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 500,
      },
      {
        name: "Barrel",
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 5000,
      },
    ];
    const itemRules: ItemRule[] = [
      {
        name: "Barrel",
        suppressed: false,
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 4000,
      },
    ];

    const resolved = resolveEffectiveRules(defaults, itemRules);
    const barrel = resolved.find((r) => r.name === "Barrel");
    const cleaning = resolved.find((r) => r.name === "Cleaning");

    expect(barrel).toMatchObject({
      intervalRounds: 4000,
      inheritanceState: "overridden",
    });
    expect(cleaning).toMatchObject({
      intervalRounds: 500,
      inheritanceState: "inherited",
    });

    // Raising the default Barrel to 6000 leaves the override standing.
    const raisedDefaults: DefaultRule[] = [
      defaults[0],
      { ...defaults[1], intervalRounds: 6000 },
    ];
    const resolvedAfterRaise = resolveEffectiveRules(raisedDefaults, itemRules);
    const barrelAfterRaise = resolvedAfterRaise.find(
      (r) => r.name === "Barrel",
    );
    expect(barrelAfterRaise?.intervalRounds).toBe(4000);
    expect(barrelAfterRaise?.inheritanceState).toBe("overridden");
  });

  test("covers AE5: a suppressed item rule removes the matching default entirely", () => {
    const defaults: DefaultRule[] = [
      {
        name: "Cleaning",
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 500,
      },
    ];
    const itemRules: ItemRule[] = [
      {
        name: "Cleaning",
        suppressed: true,
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: null,
      },
    ];

    expect(resolveEffectiveRules(defaults, itemRules)).toEqual([]);
  });

  test("an item rule with no matching default resolves as item-only and is unaffected by any default", () => {
    const defaults: DefaultRule[] = [
      {
        name: "Cleaning",
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 500,
      },
    ];
    const itemRules: ItemRule[] = [
      {
        name: "Recoil Spring",
        suppressed: false,
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: 3000,
      },
    ];

    const resolved = resolveEffectiveRules(defaults, itemRules);
    expect(resolved).toHaveLength(2);
    expect(resolved.find((r) => r.name === "Recoil Spring")).toMatchObject({
      inheritanceState: "item-only",
      intervalRounds: 3000,
    });
  });

  test("a suppressed item rule with no matching default contributes nothing and raises no error", () => {
    const itemRules: ItemRule[] = [
      {
        name: "Ghost",
        suppressed: true,
        intervalDays: null,
        intervalSessions: null,
        intervalRounds: null,
      },
    ];

    expect(resolveEffectiveRules([], itemRules)).toEqual([]);
  });

  test("empty defaults and empty item rules resolve to an empty rule set, not an error", () => {
    expect(resolveEffectiveRules([], [])).toEqual([]);
  });
});

describe("isDue", () => {
  test("covers AE2: first threshold to trip wins", () => {
    const thresholds: Thresholds = {
      intervalDays: 180,
      intervalSessions: null,
      intervalRounds: 500,
    };
    const counts: ElapsedCounts = { days: 20, sessions: 0, rounds: 640 };

    const result = isDue(thresholds, counts);
    expect(result.due).toBe(true);
    expect(result.trippedAxis).toBe("rounds");
  });

  test("a rule setting only days is not due when only rounds have accumulated past a value the rule does not set", () => {
    const thresholds: Thresholds = {
      intervalDays: 180,
      intervalSessions: null,
      intervalRounds: null,
    };
    const counts: ElapsedCounts = { days: 10, sessions: 5, rounds: 10_000 };

    expect(isDue(thresholds, counts)).toEqual({
      due: false,
      trippedAxis: null,
    });
  });

  test("a rule exactly at its threshold is due — met-or-exceeded, not exceeded", () => {
    const thresholds: Thresholds = {
      intervalDays: null,
      intervalSessions: null,
      intervalRounds: 500,
    };
    const counts: ElapsedCounts = { days: 0, sessions: 0, rounds: 500 };

    expect(isDue(thresholds, counts).due).toBe(true);
  });
});

describe("elapsedCounts", () => {
  test("a session dated the same calendar day as the measure-from date does not count; one day later does", () => {
    const measureFrom = localDate(2026, 0, 15);
    const sessions: SessionRow[] = [
      { date: localDate(2026, 0, 15), roundsFired: 50 },
      { date: localDate(2026, 0, 16), roundsFired: 30 },
    ];
    const asOf = localDate(2026, 0, 20);

    const counts = elapsedCounts(measureFrom, sessions, asOf);
    expect(counts.sessions).toBe(1);
    expect(counts.rounds).toBe(30);
  });

  test("folds multiple post-measure-from sessions into total sessions and rounds", () => {
    const measureFrom = localDate(2026, 0, 1);
    const sessions: SessionRow[] = [
      { date: localDate(2026, 0, 5), roundsFired: 100 },
      { date: localDate(2026, 0, 10), roundsFired: 200 },
      { date: localDate(2025, 11, 31), roundsFired: 999 }, // before measure-from
    ];
    const asOf = localDate(2026, 0, 15);

    const counts = elapsedCounts(measureFrom, sessions, asOf);
    expect(counts.sessions).toBe(2);
    expect(counts.rounds).toBe(300);
  });

  test("elapsed days matches calendar days regardless of runner timezone", () => {
    const measureFrom = localDate(2026, 0, 1);
    const asOf = localDate(2026, 0, 21);

    const counts = elapsedCounts(measureFrom, [], asOf);
    expect(counts.days).toBe(20);
  });

  test("an empty session list still resolves elapsed days", () => {
    const measureFrom = localDate(2026, 0, 1);
    const asOf = localDate(2026, 0, 1);

    expect(elapsedCounts(measureFrom, [], asOf)).toEqual({
      days: 0,
      sessions: 0,
      rounds: 0,
    });
  });
});
