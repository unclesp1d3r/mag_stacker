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

/**
 * Discriminated on `preset`: only the `"custom"` branch carries the
 * day-precision `after`/`before` range bounds, so a non-custom filter can't
 * even shape-wise carry stray bounds left over from a prior custom selection.
 */
export type InventoryFilter =
  | { preset: Exclude<InventoryPreset, "custom"> }
  | {
      preset: "custom";
      /** Day-precision `YYYY-MM-DD` lower bound, inclusive from the start of that local day. */
      after?: string;
      /** Day-precision `YYYY-MM-DD` upper bound, inclusive through the end of that local day. */
      before?: string;
    };

/**
 * Raw (untrusted / form) inventory-filter shape before sanitization. Unlike the
 * sanitized discriminated-union `InventoryFilter`, `after`/`before` may be present
 * on any preset — the form keeps them across preset switches so re-selecting
 * "Custom range…" restores them. Sanitized into an `InventoryFilter` for the predicate.
 */
export interface InventoryFilterInput {
  preset: InventoryPreset;
  after?: string;
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

/**
 * Epoch ms for a `YYYY-MM-DD` day string at the start (00:00:00.000) or end
 * (23:59:59.999) of that day in the *viewer's local* timezone. `null` for an
 * unparsable or invalid calendar date (e.g. `2026-02-31`).
 *
 * Local — not UTC — so the custom range matches the same calendar day the
 * column renders (`formatLastInventoried` uses `toLocaleDateString`) and the
 * day the user picked in the `<input type="date">`. The "over N days" presets
 * deliberately use absolute epoch-ms elapsed time instead (KTD-3), so those
 * stay timezone-independent; this local boundary applies only to `custom`.
 */
function dayBoundaryMs(value: string, endOfDay: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject overflowed dates (e.g. 2026-02-31), which the Date constructor would
  // otherwise silently roll forward into the next month.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

/**
 * Does `lastInventoriedAt` satisfy `filter`, evaluated relative to `now`?
 *
 * - `all`: always true.
 * - `never`: true only when never inventoried (`null`).
 * - `d30`/`d90`/`d365`: never-inventoried is maximally stale (`true`).
 *   Otherwise strictly more than the threshold's elapsed whole days
 *   (`Math.floor` on UTC epoch-ms difference — exactly N days is `false`).
 *   An unparsable `lastInventoriedAt` (`NaN` epoch) never matches.
 * - `custom`: never-inventoried can't fall in a range (`false`). `after` is
 *   an inclusive start-of-day lower bound, `before` an inclusive end-of-day
 *   upper bound; a missing bound is open on that side. An unparsable
 *   `lastInventoriedAt` never matches.
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
    const entryMs = Date.parse(lastInventoriedAt);
    if (Number.isNaN(entryMs)) return false;
    const elapsedDays = Math.floor((now.getTime() - entryMs) / MS_PER_DAY);
    return elapsedDays > PRESET_THRESHOLD_DAYS[filter.preset];
  }

  // The only remaining case, but narrow explicitly (rather than relying on
  // `isThresholdPreset` having eliminated the others) so TypeScript narrows
  // `filter` itself to the `"custom"` branch of the discriminated union and
  // allows reading `.after`/`.before` below.
  if (filter.preset !== "custom") return false;
  if (lastInventoriedAt === null) return false;
  const entryMs = Date.parse(lastInventoriedAt);
  if (Number.isNaN(entryMs)) return false;
  const lowerBound = filter.after ? dayBoundaryMs(filter.after, false) : null;
  const upperBound = filter.before ? dayBoundaryMs(filter.before, true) : null;
  if (lowerBound !== null && entryMs < lowerBound) return false;
  if (upperBound !== null && entryMs > upperBound) return false;
  return true;
}

function isInventoryPreset(value: string): value is InventoryPreset {
  return INVENTORY_PRESET_VALUES.has(value);
}

/**
 * Shape guard for a raw/persisted `InventoryFilterInput`: an object with a
 * recognized `preset`. It does NOT validate range semantics (an inverted or
 * unparsable range is still "well-shaped" and must stay visible in the form —
 * that's `sanitizeInventoryFilter`'s job for the predicate). Its only purpose is
 * to keep a structurally-broken persisted value (null, non-object, unknown
 * preset) from reaching the form controls and throwing on a `.preset` read.
 */
export function isInventoryFilterInputShape(
  value: unknown,
): value is InventoryFilterInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { preset?: unknown }).preset === "string" &&
    isInventoryPreset((value as { preset: string }).preset)
  );
}

/** Is `value` a `YYYY-MM-DD` (or otherwise `Date.parse`-able) day string? */
function isValidDayString(value: unknown): value is string {
  return typeof value === "string" && dayBoundaryMs(value, false) !== null;
}

/**
 * Validate a persisted (or otherwise untrusted) `InventoryFilter` before it
 * reaches `matchesInventoryFilter`. An unrecognized `preset`, an unparsable
 * `after`/`before`, or an inverted range (`after` later than `before`) falls
 * back to `{ preset: "all" }` rather than feeding `NaN` bounds or a
 * can-never-match range into the predicate (mirrors the view's other
 * stale-filter guards, KTD-7). A non-custom preset strips any stray
 * `after`/`before` left over from a prior custom selection — the
 * discriminated-union `InventoryFilter` shape only carries bounds under
 * `preset: "custom"`.
 */
export function sanitizeInventoryFilter(raw: unknown): InventoryFilter {
  if (typeof raw !== "object" || raw === null) {
    return { preset: "all" };
  }
  const { preset, after, before } = raw as Record<string, unknown>;

  if (typeof preset !== "string" || !isInventoryPreset(preset)) {
    return { preset: "all" };
  }
  if (preset !== "custom") {
    return { preset };
  }
  if (after !== undefined && !isValidDayString(after)) {
    return { preset: "all" };
  }
  if (before !== undefined && !isValidDayString(before)) {
    return { preset: "all" };
  }
  // Both bounds are valid day strings at this point (or absent); a `YYYY-MM-DD`
  // string compares correctly with plain `>` (lexical order matches chronological
  // order for that format), so this doesn't need `dayBoundaryMs`.
  if (after !== undefined && before !== undefined && after > before) {
    return { preset: "all" };
  }

  return {
    preset: "custom",
    ...(after !== undefined ? { after } : {}),
    ...(before !== undefined ? { before } : {}),
  };
}
