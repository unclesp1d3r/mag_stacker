/**
 * Pure formatting helper for the magazines table's "Last inventoried" column
 * (U3, #70). Kept separate from `magazines-view.tsx` so it's unit-testable
 * without pulling in React/TanStack.
 */

/**
 * Renders the calendar date a magazine was last marked "inventoried", or an
 * em-dash when it never has been. `value` is the serialized ISO datetime
 * string from `MagazineListItem.lastInventoriedAt` (null when never
 * inventoried) — only the date portion is shown, mirroring how other
 * absolute-date fields (e.g. "Acquired") render on this table, not the raw
 * timestamp used by the inventory-log history table.
 */
export function formatLastInventoried(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
