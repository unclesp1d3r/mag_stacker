"use client";

import { useMemo } from "react";
import { Callout } from "@/components/ui/feedback";
import {
  type DotMatrixResult,
  resolveDotMatrix,
} from "@/src/domain/magazines/dot-matrix";
import { MAGPUL_GLYPHS } from "@/src/domain/magazines/glyphs";

/**
 * Renders a magazine's label as Magpul PMAG Gen M3 paint-pen dot-matrix
 * glyphs (U5/U6; R4, R9, R11-R15; KTD1, KTD5, KTD6, KTD8, KTD9). Resolves
 * `resolveDotMatrix` itself and branches once on the result, so the caller
 * (`magazine-detail-view.tsx`) only ever places this component — it never
 * needs to know which of the three outcomes applies. Ships against
 * `MAGPUL_GLYPHS`, which is empty until the glyph table is transcribed
 * (KTD3), so `hidden` is the shipped outcome today.
 */

// --- Geometry (KTD6): fixed, no responsive scaling. Named constants, not
// literals scattered through the JSX. A 4-cell matrix comes out to
// 216 x 74 px, sized to fit the detail card's real ~248px content width at a
// 320px viewport.
const DOT_PITCH_PX = 16;
export const PAINTED_DOT_DIAMETER_PX = 10;
export const UNPAINTED_DOT_DIAMETER_PX = 6;
const CELL_GAP_PX = 16;
const GLYPH_COLUMNS = 3;
const GLYPH_ROWS = 5;
// The larger (painted) diameter sets the padding and cell footprint so a
// painted dot's edge never clips the cell boundary, whichever state a given
// dot is actually in.
const CELL_WIDTH_PX =
  (GLYPH_COLUMNS - 1) * DOT_PITCH_PX + PAINTED_DOT_DIAMETER_PX;
const CELL_HEIGHT_PX =
  (GLYPH_ROWS - 1) * DOT_PITCH_PX + PAINTED_DOT_DIAMETER_PX;
const DOT_CENTER_OFFSET_PX = PAINTED_DOT_DIAMETER_PX / 2;

// --- Copy (KTD8): defined once here and used by both the SVG's accessible
// name and the R4/R9 messages rendered alongside it.
export const MODEL_NOT_RECOGNIZED_CAVEAT =
  "Model not recognized — confirm this floorplate has 4 dot cells before painting.";
export const LABEL_DOES_NOT_FIT_MESSAGE =
  "This label does not fit this magazine's floorplate.";
export const UNVERIFIED_CELL_COUNT_SUFFIX =
  " The model was not recognized, so the 4-cell count is unverified.";

/** KTD8: names the cell count, then the drawn characters — phrased so it
 * cannot be mistaken for a duplicate of the stored label or a truncation
 * error, since the two differ whenever R8 drops a prefix. */
function buildAriaLabel(
  cellCount: number,
  characters: readonly string[],
): string {
  return `Dot pattern to paint on a ${cellCount}-cell floorplate: ${characters.join(" ")}`;
}

/** R9, extended with the unverified clause when the cell count came from
 * R4's unrecognized-model fallback rather than a matched entry. */
function buildDoesNotFitMessage(cellCountVerified: boolean): string {
  return cellCountVerified
    ? LABEL_DOES_NOT_FIT_MESSAGE
    : `${LABEL_DOES_NOT_FIT_MESSAGE}${UNVERIFIED_CELL_COUNT_SUFFIX}`;
}

interface DotMatrixLabelProps {
  label: string;
  brandModel: string;
  /** The magazine owner's Magpul mode (R6) — not necessarily the viewer's. */
  ownerMagpulMode: boolean;
}

export function DotMatrixLabel({
  label,
  brandModel,
  ownerMagpulMode,
}: DotMatrixLabelProps) {
  // KTD9: keyed on primitives, never a parent-owned object — this repo runs
  // reactCompiler: true, where a freshly-built array handed to a memoized
  // child renders stale. MAGPUL_GLYPHS is a module-level constant, not a
  // dependency.
  const result: DotMatrixResult = useMemo(
    () =>
      resolveDotMatrix({
        label,
        brandModel,
        ownerMagpulMode,
        glyphs: MAGPUL_GLYPHS,
      }),
    [label, brandModel, ownerMagpulMode],
  );

  // R10/KTD3: hidden renders nothing at all — no SVG, no empty container, no
  // placeholder grid, no caption. Returning null here (rather than an empty
  // wrapper in the caller) is what keeps that guarantee exact.
  if (result.kind === "hidden") return null;

  if (result.kind === "unrepresentable") {
    return (
      <Callout tone="destructive">
        {buildDoesNotFitMessage(result.cellCountVerified)}
      </Callout>
    );
  }

  const { characters, cells, cellCount, cellCountVerified } = result;
  // Sized from `cells.length` (how many cell groups are actually drawn by the
  // .map below), NOT `cellCount` (the floorplate's total capacity, used only
  // for `buildAriaLabel`). A label shorter than the floorplate's cell count
  // — the ordinary case — draws fewer groups than the floorplate holds, and
  // sizing the canvas off the untouched `cellCount` would leave blank,
  // unexplained space to the right of the drawn dots.
  const width = cells.length * CELL_WIDTH_PX + (cells.length - 1) * CELL_GAP_PX;

  return (
    <div className="space-y-2">
      <svg
        role="img"
        aria-label={buildAriaLabel(cellCount, characters)}
        width={width}
        height={CELL_HEIGHT_PX}
        viewBox={`0 0 ${width} ${CELL_HEIGHT_PX}`}
      >
        {cells.map((cell, cellIndex) => {
          const cellOffsetX = cellIndex * (CELL_WIDTH_PX + CELL_GAP_PX);
          return cell.map((row, rowIndex) =>
            row.map((painted, columnIndex) => {
              const cx =
                cellOffsetX + DOT_CENTER_OFFSET_PX + columnIndex * DOT_PITCH_PX;
              const cy = DOT_CENTER_OFFSET_PX + rowIndex * DOT_PITCH_PX;
              const diameter = painted
                ? PAINTED_DOT_DIAMETER_PX
                : UNPAINTED_DOT_DIAMETER_PX;
              return (
                <circle
                  // biome-ignore lint/suspicious/noArrayIndexKey: (cell, row, column) is the dot's stable identity in the fixed, never-reordered glyph grid.
                  key={`${cellIndex}-${rowIndex}-${columnIndex}`}
                  cx={cx}
                  cy={cy}
                  r={diameter / 2}
                  className={
                    painted ? "fill-dot-painted" : "fill-dot-unpainted"
                  }
                />
              );
            }),
          );
        })}
      </svg>
      {!cellCountVerified ? (
        <Callout tone="neutral">{MODEL_NOT_RECOGNIZED_CAVEAT}</Callout>
      ) : null}
    </div>
  );
}
