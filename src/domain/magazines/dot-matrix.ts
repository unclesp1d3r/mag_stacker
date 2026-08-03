/**
 * Label-to-matrix resolution (U3, KTD2, KTD3; R6-R10). Pure — no DB, no
 * React.
 *
 * `resolveDotMatrix` turns a magazine's label, model, and owner Magpul mode
 * into one of three structured outcomes, so the presentation layer branches
 * once over a discriminated union rather than a chain of nullable fields.
 * Only the glyph table is a caller-supplied parameter (KTD2) — production
 * wiring hands it `MAGPUL_GLYPHS`, and `__tests__/dot-matrix.test.ts` covers
 * every rule twice: once against a synthetic all-characters fixture (which
 * isolates each rule from the real font's coverage), and once against the
 * shipped `MAGPUL_GLYPHS` (which is what actually renders). Both matter —
 * the two disagree wherever a character is outside Magpul's 36-glyph sheet.
 * Cell-count resolution calls U2's `resolveCellCount` directly; the model
 * list itself is a code-only, non-owner-editable lookup (Product Contract,
 * session-settled), not something a caller substitutes.
 */

import { normalizeMagpulLabel } from "./constants";
import { resolveCellCount } from "./floorplate";
import type { GlyphCell, GlyphTable } from "./glyphs";

/**
 * Why a label could not be drawn at all. The two causes call for different
 * copy: telling an owner their label "does not fit" a 4-cell floorplate when
 * the real problem is that no character in it has a glyph is simply false.
 *
 * `unsupportedCharacter` is now the narrow case — a label with *nothing*
 * paintable in it (`"--"`). A label that is only partly outside the font
 * drops the unpaintable characters and renders the rest (R9a), so it is a
 * `matrix`, not an `unrepresentable`.
 */
export type UnrepresentableReason = "unsupportedCharacter" | "doesNotFit";

/** Every rule in R6-R10 is a named case, not a nullable field. */
export type DotMatrixResult =
  | { kind: "hidden" }
  | {
      kind: "matrix";
      /** The characters actually drawn, in order (R7 the whole label, R8 the trailing digit run). */
      characters: readonly string[];
      /** The glyph cell for each drawn character, same order as `characters`. */
      cells: readonly GlyphCell[];
      /** The floorplate's per-face cell count (R3, R5). */
      cellCount: number;
      /** False when `cellCount` came from R4's unrecognized-model fallback. */
      cellCountVerified: boolean;
      /**
       * Distinct characters dropped for lack of a glyph (R9a), in first-seen
       * order — empty in the ordinary case. Populated only when the whole
       * paintable label is drawn: once R8 drops a prefix, the accessible name
       * already discloses exactly what is drawn, and naming a hyphen that sat
       * in the discarded prefix would be noise rather than information.
       */
      omitted: readonly string[];
    }
  | {
      kind: "unrepresentable";
      /** Which of R9's two causes fired — selects the message the view shows. */
      reason: UnrepresentableReason;
      cellCount: number;
      cellCountVerified: boolean;
    };

export interface ResolveDotMatrixInput {
  label: string;
  brandModel: string;
  ownerMagpulMode: boolean;
  glyphs: GlyphTable;
}

/** The maximal run of `0-9` at the end of `value`, or `""` when there is none. */
function trailingDigitRun(value: string): string {
  const match = value.match(/[0-9]+$/);
  return match ? match[0] : "";
}

/**
 * Resolves in the order the Product Contract's flowchart specifies: owner
 * mode off, then an empty label, then an empty glyph table (KTD3) all yield
 * `hidden`; then cell count is resolved from `brandModel`; then characters
 * with no glyph are dropped (R9a); then length against the cell count; then
 * the trailing-digit fallback.
 *
 * Dropping precedes both length checks, so it is the *paintable* label that
 * is measured against the floorplate — `A-1` occupies three cells, not four.
 */
export function resolveDotMatrix(
  input: ResolveDotMatrixInput,
): DotMatrixResult {
  const { label, brandModel, ownerMagpulMode, glyphs } = input;

  if (!ownerMagpulMode) return { kind: "hidden" };

  const normalizedLabel = normalizeMagpulLabel(label);
  if (normalizedLabel === "") return { kind: "hidden" };

  // KTD3: an empty glyph table suppresses the matrix entirely — this is the
  // mechanism by which the feature ships dark, not an R9 "does not fit".
  if (glyphs.size === 0) return { kind: "hidden" };

  const { cells: cellCount, matched } = resolveCellCount(brandModel);
  const cellCountVerified = matched;

  // R9a: a character with no glyph is dropped, not fatal. Magpul's floorplate
  // physically has no hyphen cell, so a hyphen can never be painted — the
  // same kind of hard constraint that makes R8 drop a prefix that will not
  // fit. Refusing to draw anything for `A-1` would withhold a pattern the
  // owner can actually paint over a character that was never paintable.
  const characters = [...normalizedLabel];
  const paintable = characters.filter((character) => glyphs.has(character));
  const omitted = [
    ...new Set(characters.filter((character) => !glyphs.has(character))),
  ];

  // Nothing survived the drop, so there is no pattern to offer.
  if (paintable.length === 0) {
    return {
      kind: "unrepresentable",
      reason: "unsupportedCharacter",
      cellCount,
      cellCountVerified,
    };
  }

  if (paintable.length <= cellCount) {
    return buildMatrixResult(
      paintable,
      glyphs,
      cellCount,
      cellCountVerified,
      omitted,
    );
  }

  // Measured over the paintable label, not the stored one: the digits that
  // reach the floorplate are the ones that have glyphs.
  const trailingDigits = trailingDigitRun(paintable.join(""));
  if (trailingDigits.length > 0 && trailingDigits.length <= cellCount) {
    // `omitted` is deliberately dropped here — see the field's doc comment.
    return buildMatrixResult(
      [...trailingDigits],
      glyphs,
      cellCount,
      cellCountVerified,
      [],
    );
  }

  return {
    kind: "unrepresentable",
    reason: "doesNotFit",
    cellCount,
    cellCountVerified,
  };
}

function buildMatrixResult(
  characters: readonly string[],
  glyphs: GlyphTable,
  cellCount: number,
  cellCountVerified: boolean,
  omitted: readonly string[],
): DotMatrixResult {
  const cells = characters.map((character) => {
    const cell = glyphs.get(character);
    if (!cell) {
      // Every caller filters to characters the table holds before reaching
      // here, so a miss would mean the filter and the lookup disagreed.
      throw new Error(
        `Internal error: no glyph cell for character "${character}" after the paintable filter passed.`,
      );
    }
    return cell;
  });
  return {
    kind: "matrix",
    characters,
    cells,
    cellCount,
    cellCountVerified,
    omitted,
  };
}
