/**
 * Magpul PMAG Gen M3 dot-matrix glyph font (U1; R1, R2). Pure — no DB, no
 * React.
 *
 * Parses the checked-in glyph fixture (`src/data/magpul-glyphs.txt`, embedded
 * as `MAGPUL_GLYPHS_RAW` in `src/data/raw.ts`) into a lookup from character to
 * a fixed 3-column x 5-row dot cell. `MAGPUL_GLYPHS` is exported as a plain
 * parsed constant rather than a cache-returning function: `resolveDotMatrix`
 * (U3, KTD2) takes the glyph table as a parameter, so production wiring and
 * tests both hand it a `GlyphTable` value directly instead of importing a
 * shared cache. Mirrors `src/domain/reference/reference.ts`'s note that a
 * shallow `Object.freeze` would not protect a glyph cell's nested row arrays
 * anyway, so none is applied here — readonly types are the contract.
 *
 * The fixture ships with zero glyph rows until Magpul's diagram is
 * transcribed (KTD3) — an empty `GlyphTable` is a valid, expected state, not
 * an error, and is exactly what makes the feature ship dark.
 */

import { MAGPUL_GLYPHS_RAW } from "@/src/data/raw";
import {
  MAGPUL_LABEL_ALLOWED_DESCRIPTION,
  MAGPUL_LABEL_ALLOWED_RE,
} from "@/src/domain/magazines/constants";

/** One row of a glyph cell: `true` = painted dot, `false` = unpainted (R11). */
export type GlyphRow = readonly boolean[];

/** A glyph's fixed dot cell: 3 columns x 5 rows (R2). */
export type GlyphCell = readonly GlyphRow[];

/** Character -> glyph cell lookup, keyed on the literal transcribed character. */
export type GlyphTable = ReadonlyMap<string, GlyphCell>;

const ROWS_PER_GLYPH = 5;
const COLS_PER_GLYPH = 3;
const PAINTED_MARK = "#";
const UNPAINTED_MARK = ".";

/**
 * Parses one glyph row (`rowField`, e.g. `"#.#"`) into a `GlyphRow`. Throws
 * when the row is not exactly `COLS_PER_GLYPH` characters wide, or contains
 * any mark other than `#` or `.` — a malformed transcription fails loudly at
 * parse time rather than silently rendering a wrong pattern later.
 */
function parseGlyphRow(character: string, rowField: string): GlyphRow {
  if (rowField.length !== COLS_PER_GLYPH) {
    throw new Error(
      `Glyph "${character}" row "${rowField}" has ${rowField.length} columns; expected ${COLS_PER_GLYPH}.`,
    );
  }
  const dots: boolean[] = [];
  for (const mark of rowField) {
    if (mark === PAINTED_MARK) {
      dots.push(true);
    } else if (mark === UNPAINTED_MARK) {
      dots.push(false);
    } else {
      throw new Error(
        `Glyph "${character}" row "${rowField}" contains invalid mark "${mark}" (expected "${PAINTED_MARK}" or "${UNPAINTED_MARK}").`,
      );
    }
  }
  return dots;
}

/**
 * Parses the glyph fixture format: one glyph per line, `<character> <row1>
 * <row2> <row3> <row4> <row5>`, each row exactly `COLS_PER_GLYPH` characters
 * of `#`/`.`. Blank lines and lines beginning with `#` in column zero are
 * comments — unambiguous, because a glyph row's first field is always a
 * single character followed by a space, and `#` itself is outside R1's font.
 *
 * Throws on any malformed row: wrong row count, wrong row width, a mark
 * outside `#.`, a glyph key outside the Magpul label character set (R1:
 * `A-Z`, `0-9`, hyphen — shared with `MAGPUL_LABEL_ALLOWED_RE`), or a
 * duplicate glyph character declared twice. Rejecting an out-of-set key here
 * matters beyond transcription hygiene: R9 treats a label containing a
 * character absent from the font as unrepresentable, and a stray accepted
 * glyph (e.g. `.` or a lowercase letter) would let a nonconforming label
 * render instead. Empty input (or input that is entirely comments/blank
 * lines) yields an empty table — a valid state, not an error (KTD3).
 */
export function parseGlyphTable(raw: string): GlyphTable {
  const table = new Map<string, GlyphCell>();

  for (const line of raw.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;

    const [character, ...rowFields] = line.trim().split(/\s+/);

    if (character?.length !== 1) {
      throw new Error(`Malformed glyph line (missing character): "${line}"`);
    }
    if (!MAGPUL_LABEL_ALLOWED_RE.test(character)) {
      throw new Error(
        `Glyph key "${character}" is outside the supported character set (${MAGPUL_LABEL_ALLOWED_DESCRIPTION}).`,
      );
    }
    if (table.has(character)) {
      throw new Error(`Duplicate glyph declaration for "${character}".`);
    }
    if (rowFields.length !== ROWS_PER_GLYPH) {
      throw new Error(
        `Glyph "${character}" declares ${rowFields.length} rows; expected ${ROWS_PER_GLYPH}.`,
      );
    }

    const cell: GlyphRow[] = rowFields.map((rowField) =>
      parseGlyphRow(character, rowField),
    );
    table.set(character, cell);
  }

  return table;
}

/** Parsed once at module load from the checked-in fixture (KTD2, KTD3). */
export const MAGPUL_GLYPHS: GlyphTable = parseGlyphTable(MAGPUL_GLYPHS_RAW);
