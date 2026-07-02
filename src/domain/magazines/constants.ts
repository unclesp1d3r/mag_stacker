/**
 * Shared Magpul-label constants (U2, KTD-1..KTD-6 of the Magpul-mode plan).
 *
 * Single source of truth for the PMAG Gen M3 dot-matrix label rule so the
 * domain validator and the magazine form agree; the #20 renderer and #22
 * auto-numbering import these when built. Derived from Magpul's published PMAG
 * Gen M3 dot-matrix diagram: 4 dot cells, glyph set A-Z / 0-9 / hyphen.
 */

/** Max label length when Magpul mode is on — the floorplate's 4 dot cells. */
export const MAX_LABEL_LENGTH = 4;

/** A normalized label is valid only if it matches (empty allowed). */
export const MAGPUL_LABEL_ALLOWED_RE = /^[A-Z0-9-]*$/;

/** Global matcher for characters the input mask strips (anything unsupported). */
export const MAGPUL_LABEL_DISALLOWED_CHAR_RE = /[^A-Z0-9-]/g;

/** Human-facing description of the allowed set, for helper text and errors. */
export const MAGPUL_LABEL_ALLOWED_DESCRIPTION = "A-Z, 0-9, and hyphen";

/**
 * Normalize a raw label for Magpul mode: uppercase, then trim outer whitespace.
 * Used both to run validation checks and to compute the stored value. Does NOT
 * strip unsupported characters — those are rejected, not silently removed.
 */
export function normalizeMagpulLabel(raw: string): string {
  return raw.toUpperCase().trim();
}
