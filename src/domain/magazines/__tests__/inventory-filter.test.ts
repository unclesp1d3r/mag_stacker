import { describe, expect, test } from "bun:test";
import {
  type InventoryFilter,
  isInventoryFilterInputShape,
  matchesInventoryFilter,
  sanitizeInventoryFilter,
} from "../inventory-filter";

/** Fixed "now" for every test, so day-boundary math is deterministic (U4, #70). */
const NOW = new Date("2026-06-01T12:00:00.000Z");

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

describe("matchesInventoryFilter", () => {
  describe("all preset", () => {
    test("matches a never-inventoried magazine", () => {
      expect(matchesInventoryFilter(null, { preset: "all" }, NOW)).toBe(true);
    });

    test("matches a recently-inventoried magazine", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 1), { preset: "all" }, NOW),
      ).toBe(true);
    });

    test("matches a long-stale magazine", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 1000), { preset: "all" }, NOW),
      ).toBe(true);
    });
  });

  describe("never preset", () => {
    test("matches only a null lastInventoriedAt", () => {
      expect(matchesInventoryFilter(null, { preset: "never" }, NOW)).toBe(true);
    });

    test("does not match any inventoried date", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 400), { preset: "never" }, NOW),
      ).toBe(false);
    });
  });

  describe("d90 preset (strict greater-than threshold)", () => {
    test("matches a magazine inventoried 100 days ago", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 100), { preset: "d90" }, NOW),
      ).toBe(true);
    });

    test("does not match a magazine inventoried exactly 90 days ago", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 90), { preset: "d90" }, NOW),
      ).toBe(false);
    });

    test("does not match a magazine inventoried 30 days ago", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 30), { preset: "d90" }, NOW),
      ).toBe(false);
    });

    test("matches a never-inventoried magazine (maximally stale)", () => {
      expect(matchesInventoryFilter(null, { preset: "d90" }, NOW)).toBe(true);
    });

    test("does not match an unparsable lastInventoriedAt", () => {
      expect(matchesInventoryFilter("not-a-date", { preset: "d90" }, NOW)).toBe(
        false,
      );
    });
  });

  describe("d30 and d365 presets share the same strict threshold semantics", () => {
    test("d30 matches an entry 31 days old but not 30 days old", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 31), { preset: "d30" }, NOW),
      ).toBe(true);
      expect(
        matchesInventoryFilter(daysBefore(NOW, 30), { preset: "d30" }, NOW),
      ).toBe(false);
    });

    test("d365 matches an entry 366 days old but not 365 days old", () => {
      expect(
        matchesInventoryFilter(daysBefore(NOW, 366), { preset: "d365" }, NOW),
      ).toBe(true);
      expect(
        matchesInventoryFilter(daysBefore(NOW, 365), { preset: "d365" }, NOW),
      ).toBe(false);
    });
  });

  describe("custom preset", () => {
    const range: InventoryFilter = {
      preset: "custom",
      after: "2026-01-01",
      before: "2026-01-31",
    };

    test("never-inventoried never matches a custom range", () => {
      expect(matchesInventoryFilter(null, range, NOW)).toBe(false);
    });

    test("a date inside the range matches", () => {
      expect(
        matchesInventoryFilter("2026-01-15T10:00:00.000Z", range, NOW),
      ).toBe(true);
    });

    test("a date outside the range does not match", () => {
      expect(
        matchesInventoryFilter("2026-02-15T10:00:00.000Z", range, NOW),
      ).toBe(false);
    });

    test("`before` is inclusive through end-of-day, not just midnight", () => {
      expect(
        matchesInventoryFilter("2026-01-31T23:30:00.000Z", range, NOW),
      ).toBe(true);
    });

    test("`after` is inclusive from start-of-day", () => {
      expect(
        matchesInventoryFilter("2026-01-01T00:00:00.000Z", range, NOW),
      ).toBe(true);
    });

    test("a missing `after` leaves the lower bound open", () => {
      const openLower: InventoryFilter = {
        preset: "custom",
        before: "2026-01-31",
      };
      expect(
        matchesInventoryFilter("2020-01-01T00:00:00.000Z", openLower, NOW),
      ).toBe(true);
    });

    test("a missing `before` leaves the upper bound open", () => {
      const openUpper: InventoryFilter = {
        preset: "custom",
        after: "2026-01-01",
      };
      expect(
        matchesInventoryFilter("2030-01-01T00:00:00.000Z", openUpper, NOW),
      ).toBe(true);
    });

    test("does not match an unparsable lastInventoriedAt", () => {
      expect(matchesInventoryFilter("not-a-date", range, NOW)).toBe(false);
    });
  });
});

describe("sanitizeInventoryFilter", () => {
  test("an unknown preset falls back to all", () => {
    expect(sanitizeInventoryFilter({ preset: "yesterday" })).toEqual({
      preset: "all",
    });
  });

  test("a non-object value falls back to all", () => {
    expect(sanitizeInventoryFilter(null)).toEqual({ preset: "all" });
    expect(sanitizeInventoryFilter("all")).toEqual({ preset: "all" });
    expect(sanitizeInventoryFilter(undefined)).toEqual({ preset: "all" });
  });

  test("an unparsable `after` falls back to all", () => {
    expect(
      sanitizeInventoryFilter({ preset: "custom", after: "not-a-date" }),
    ).toEqual({ preset: "all" });
  });

  test("an unparsable `before` falls back to all", () => {
    expect(
      sanitizeInventoryFilter({
        preset: "custom",
        after: "2026-01-01",
        before: "banana",
      }),
    ).toEqual({ preset: "all" });
  });

  test("a valid custom filter passes through unchanged", () => {
    const valid: InventoryFilter = {
      preset: "custom",
      after: "2026-01-01",
      before: "2026-01-31",
    };
    expect(sanitizeInventoryFilter(valid)).toEqual(valid);
  });

  test("a valid preset-only filter passes through unchanged", () => {
    expect(sanitizeInventoryFilter({ preset: "d90" })).toEqual({
      preset: "d90",
    });
  });

  test("a non-custom preset strips a stray `after` left over from a prior custom selection", () => {
    expect(
      sanitizeInventoryFilter({ preset: "d90", after: "2026-01-01" }),
    ).toEqual({ preset: "d90" });
  });

  test("an overflowed custom-range date (e.g. Feb 31) is rejected", () => {
    expect(
      sanitizeInventoryFilter({ preset: "custom", after: "2026-02-31" }),
    ).toEqual({ preset: "all" });
  });

  test("an inverted custom range (`after` later than `before`) falls back to all", () => {
    expect(
      sanitizeInventoryFilter({
        preset: "custom",
        after: "2026-06-01",
        before: "2026-01-01",
      }),
    ).toEqual({ preset: "all" });
  });

  test("a fully-open custom range (no bounds) passes through unchanged", () => {
    expect(sanitizeInventoryFilter({ preset: "custom" })).toEqual({
      preset: "custom",
    });
  });
});

describe("isInventoryFilterInputShape", () => {
  // Shape-only guard for the persisted/raw value on the display path
  // (`app/(app)/magazines/magazines-view.tsx`): a corrupted persisted
  // `viewState.filters.inventory` (KTD-7, PR #72 re-review) must not reach a
  // `.preset` read and throw. It deliberately does NOT judge range semantics —
  // that's `sanitizeInventoryFilter`'s job for the predicate.

  test("null is not well-shaped", () => {
    expect(isInventoryFilterInputShape(null)).toBe(false);
  });

  test("a non-object value is not well-shaped", () => {
    expect(isInventoryFilterInputShape("x")).toBe(false);
    expect(isInventoryFilterInputShape(42)).toBe(false);
  });

  test("an unrecognized preset is not well-shaped", () => {
    expect(isInventoryFilterInputShape({ preset: "nonsense" })).toBe(false);
  });

  test("a recognized preset-only value is well-shaped", () => {
    expect(isInventoryFilterInputShape({ preset: "all" })).toBe(true);
  });

  test("a custom preset with semantically-invalid bounds is still well-shaped", () => {
    // Well-shaped even though the bounds are garbage — those get sanitized
    // later (by `sanitizeInventoryFilter`, for the predicate only), not here.
    expect(
      isInventoryFilterInputShape({
        preset: "custom",
        after: "garbage",
        before: "x",
      }),
    ).toBe(true);
  });
});

describe("sanitizeInventoryFilter + matchesInventoryFilter: fully-open custom range", () => {
  test("a fully-open custom range matches any real date", () => {
    const sanitized = sanitizeInventoryFilter({ preset: "custom" });
    expect(
      matchesInventoryFilter("2020-01-01T00:00:00.000Z", sanitized, NOW),
    ).toBe(true);
    expect(
      matchesInventoryFilter("2030-01-01T00:00:00.000Z", sanitized, NOW),
    ).toBe(true);
  });

  test("a fully-open custom range does not match never-inventoried", () => {
    const sanitized = sanitizeInventoryFilter({ preset: "custom" });
    expect(matchesInventoryFilter(null, sanitized, NOW)).toBe(false);
  });
});
