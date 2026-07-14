/**
 * Pure predicate + validation for the magazines list's inventory-date filter
 * (U4, #70): preset buckets ("never inventoried", "over N days") plus a
 * custom after/before range, AND-combined with the view's other filters.
 * Kept dependency-free (no React/TanStack) so it's directly unit-testable.
 */

export type InventoryPreset =
  | "all"
  | "never"
  | "d30"
  | "d90"
  | "d365"
  | "custom";

export interface InventoryFilter {
  preset: InventoryPreset;
  /** Day-precision `YYYY-MM-DD` lower bound, inclusive from start-of-day (UTC). Only meaningful for `custom`. */
  after?: string;
  /** Day-precision `YYYY-MM-DD` upper bound, inclusive through end-of-day (UTC). Only meaningful for `custom`. */
  before?: string;
}

/** Preset labels for the filter `<Select>` — one source shared by the view and its tests. */
export const INVENTORY_PRESET_OPTIONS: ReadonlyArray<{
  value: InventoryPreset;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "never", label: "Never inventoried" },
  { value: "d30", label: "Over 30 days" },
  { value: "d90", label: "Over 90 days" },
  { value: "d365", label: "Over 1 year" },
  { value: "custom", label: "Custom range…" },
];

const INVENTORY_PRESET_VALUES: ReadonlySet<string> = new Set(
  INVENTORY_PRESET_OPTIONS.map((option) => option.value),
);

/** Elapsed-day threshold (strict greater-than) for each "stale" preset. */
const PRESET_THRESHOLD_DAYS: Record<"d30" | "d90" | "d365", number> = {
  d30: 30,
  d90: 90,
  d365: 365,
};

const MS_PER_DAY = 86_400_000;

function isThresholdPreset(
  preset: InventoryPreset,
): preset is "d30" | "d90" | "d365" {
  return preset === "d30" || preset === "d90" || preset === "d365";
}

/** Epoch ms for a `YYYY-MM-DD` day string at its start (00:00:00.000) or end (23:59:59.999) of day, UTC. `null` if unparsable. */
function dayBoundaryMs(value: string, endOfDay: boolean): number | null {
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const ms = Date.parse(`${value}${suffix}`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Does `lastInventoriedAt` satisfy `filter`, evaluated relative to `now`?
 *
 * - `all`: always true.
 * - `never`: true only when never inventoried (`null`).
 * - `d30`/`d90`/`d365`: never-inventoried is maximally stale (`true`).
 *   Otherwise strictly more than the threshold's elapsed whole days
 *   (`Math.floor` on UTC epoch-ms difference — exactly N days is `false`).
 * - `custom`: never-inventoried can't fall in a range (`false`). `after` is
 *   an inclusive start-of-day lower bound, `before` an inclusive end-of-day
 *   upper bound; a missing bound is open on that side.
 */
export function matchesInventoryFilter(
  lastInventoriedAt: string | null,
  filter: InventoryFilter,
  now: Date,
): boolean {
  if (filter.preset === "all") return true;
  if (filter.preset === "never") return lastInventoriedAt === null;

  if (isThresholdPreset(filter.preset)) {
    if (lastInventoriedAt === null) return true;
    const elapsedDays = Math.floor(
      (now.getTime() - Date.parse(lastInventoriedAt)) / MS_PER_DAY,
    );
    return elapsedDays > PRESET_THRESHOLD_DAYS[filter.preset];
  }

  // preset === "custom"
  if (lastInventoriedAt === null) return false;
  const entryMs = Date.parse(lastInventoriedAt);
  const lowerBound = filter.after ? dayBoundaryMs(filter.after, false) : null;
  const upperBound = filter.before ? dayBoundaryMs(filter.before, true) : null;
  if (lowerBound !== null && entryMs < lowerBound) return false;
  if (upperBound !== null && entryMs > upperBound) return false;
  return true;
}

function isInventoryPreset(value: string): value is InventoryPreset {
  return INVENTORY_PRESET_VALUES.has(value);
}

/** Is `value` a `YYYY-MM-DD` (or otherwise `Date.parse`-able) day string? */
function isValidDayString(value: unknown): value is string {
  return typeof value === "string" && dayBoundaryMs(value, false) !== null;
}

/**
 * Validate a persisted (or otherwise untrusted) `InventoryFilter` before it
 * reaches `matchesInventoryFilter`. An unrecognized `preset`, or an
 * unparsable `after`/`before`, falls back to `{ preset: "all" }` rather than
 * feeding `NaN` bounds into the predicate (mirrors the view's other
 * stale-filter guards, KTD-7).
 */
export function sanitizeInventoryFilter(raw: unknown): InventoryFilter {
  if (typeof raw !== "object" || raw === null) {
    return { preset: "all" };
  }
  const { preset, after, before } = raw as Record<string, unknown>;

  if (typeof preset !== "string" || !isInventoryPreset(preset)) {
    return { preset: "all" };
  }
  if (after !== undefined && !isValidDayString(after)) {
    return { preset: "all" };
  }
  if (before !== undefined && !isValidDayString(before)) {
    return { preset: "all" };
  }

  return {
    preset,
    ...(isValidDayString(after) ? { after } : {}),
    ...(isValidDayString(before) ? { before } : {}),
  };
}
