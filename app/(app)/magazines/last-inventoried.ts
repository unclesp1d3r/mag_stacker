/**
 * Pure formatting helper for the magazines table's "Last inventoried" column
 * (U3, #70). Kept separate from `magazines-view.tsx` so it's unit-testable
 * without pulling in React/TanStack.
 */

/**
 * Renders the calendar date a magazine was last marked "inventoried", or an
 * em-dash when it never has been (or the stored value is unparsable). `value`
 * is the serialized ISO datetime string from `MagazineListItem.lastInventoriedAt`
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
