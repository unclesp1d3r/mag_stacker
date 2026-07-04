/**
 * Bulk-add label algorithm (U10, parity §10.3–§10.4 + §12.4). Pure.
 */

import { MAX_BULK_ADD_COUNT } from "@/src/domain/magazines/validate";

/**
 * Generate `count` labels starting at `startAt`.
 *
 * - Empty/whitespace-only prefix ⇒ all labels are empty strings (no numbering).
 * - `count < 1`, or `count` above the bulk-add ceiling ⇒ no labels. Callers
 *   validate `count` first (R53); the upper bound here is a defensive cap so the
 *   function never allocates an array from an unbounded, caller-supplied length.
 * - Otherwise `<prefix><N>` zero-padded to width = max(2, digits in the largest
 *   N emitted), so the width grows as the sequence crosses 99 → 100, etc.
 */
export function generateLabels(
  prefix: string,
  count: number,
  startAt = 1,
): string[] {
  if (count < 1 || count > MAX_BULK_ADD_COUNT) return [];
  if (prefix.trim() === "") return new Array(count).fill("");

  const largest = startAt + count - 1;
  const width = Math.max(2, String(largest).length);
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    labels.push(`${prefix}${String(startAt + i).padStart(width, "0")}`);
  }
  return labels;
}

/**
 * The next sequence start for `prefix`, continuing past the highest existing
 * `<prefix><positive-integer>` label (collision avoidance, R55). Labels equal to
 * the prefix exactly, with a non-numeric suffix, or with a zero/negative numeric
 * suffix are ignored. No matching labels ⇒ 1.
 */
export function nextLabelStart(
  existingLabels: string[],
  prefix: string,
): number {
  if (prefix === "") return 1;
  let highest = 0;
  for (const label of existingLabels) {
    if (!label.startsWith(prefix)) continue;
    const suffix = label.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = Number.parseInt(suffix, 10);
    if (n > 0 && n > highest) highest = n;
  }
  return highest + 1;
}

/**
 * Map each prefix to its next sequence start (#22). Pure; drives the single-add
 * label prefill without a per-keystroke round-trip. A prefix with no matching
 * labels maps to 1 (via `nextLabelStart`). Callers are expected to default any
 * prefix absent from the map (e.g. a freshly typed one) to 1 themselves.
 */
export function nextStartForPrefixes(
  existingLabels: string[],
  prefixes: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const prefix of prefixes) {
    out[prefix] = nextLabelStart(existingLabels, prefix);
  }
  return out;
}
