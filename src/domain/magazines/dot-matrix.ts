/**
 * Label-to-matrix resolution (U3, KTD2, KTD3; R6-R10). Pure — no DB, no
 * React.
 *
 * `resolveDotMatrix` turns a magazine's label, model, and owner Magpul mode
 * into one of three structured outcomes, so the presentation layer branches
 * once over a discriminated union rather than a chain of nullable fields.
 * Only the glyph table is a caller-supplied parameter (KTD2) — production
 * wiring hands it `MAGPUL_GLYPHS`, and every test in
 * `__tests__/dot-matrix.test.ts` hands it a synthetic fixture, which is what
 * makes R7-R10 fully testable today even though the shipped font is empty.
 * Cell-count resolution calls U2's `resolveCellCount` directly; the model
 * list itself is a code-only, non-owner-editable lookup (Product Contract,
 * session-settled), not something a caller substitutes.
 */

import { normalizeMagpulLabel } from "./constants";
import { resolveCellCount } from "./floorplate";
import type { GlyphCell, GlyphTable } from "./glyphs";

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
    }
  | {
      kind: "unrepresentable";
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
 * `hidden`; then cell count is resolved from `brandModel`; then font
 * coverage is checked against the whole normalized label (R9's first
 * clause, before any truncation); then length against the cell count; then
 * the trailing-digit fallback.
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

  const characters = [...normalizedLabel];
  const hasFullFontCoverage = characters.every((character) =>
    glyphs.has(character),
  );
  if (!hasFullFontCoverage) {
    return { kind: "unrepresentable", cellCount, cellCountVerified };
  }

  if (characters.length <= cellCount) {
    return buildMatrixResult(characters, glyphs, cellCount, cellCountVerified);
  }

  const trailingDigits = trailingDigitRun(normalizedLabel);
  if (trailingDigits.length > 0 && trailingDigits.length <= cellCount) {
    return buildMatrixResult(
      [...trailingDigits],
      glyphs,
      cellCount,
      cellCountVerified,
    );
  }

  return { kind: "unrepresentable", cellCount, cellCountVerified };
}

function buildMatrixResult(
  characters: readonly string[],
  glyphs: GlyphTable,
  cellCount: number,
  cellCountVerified: boolean,
): DotMatrixResult {
  const cells = characters.map((character) => {
    const cell = glyphs.get(character);
    if (!cell) {
      // Coverage was already checked against the full label before this
      // point, so a miss here would mean the two checks disagreed.
      throw new Error(
        `Internal error: no glyph cell for character "${character}" after coverage check passed.`,
      );
    }
    return cell;
  });
  return { kind: "matrix", characters, cells, cellCount, cellCountVerified };
}
