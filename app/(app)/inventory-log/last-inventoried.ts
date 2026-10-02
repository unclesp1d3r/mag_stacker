/**
 * Pure formatting and sort helpers for a "Last inventoried" column or row
 * (U3, #70; shared with ammo since #100, plan KTD7). Kept separate from the
 * views so they're unit-testable without pulling in React/TanStack. Consumed
 * by `magazines-view.tsx`, `ammo-view.tsx`, and `ammo-detail-view.tsx`.
 */

/**
 * Renders the calendar date an item was last marked "inventoried", or an
 * em-dash when it never has been (or the stored value is unparsable). `value`
 * is the serialized ISO datetime string from the list item's `lastInventoriedAt`
 * (null when never inventoried) — only the date portion is shown, as an
 * absolute, locale-formatted date. This is not byte-identical to the
 * "Acquired" column, which renders its raw stored date string directly (a
 * true-empty null, not this em-dash); it just shares the same
 * date-only-not-timestamp intent, not the same rendering path.
 */
export function formatLastInventoried(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Sort key for the "Last inventoried" column: epoch ms, or -Infinity for
 * never-inventoried (or an unparsable value) so those rows sort as maximally
 * stale and follow the sort direction (top ascending, bottom descending).
 */
export function lastInventoriedSortValue(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}
