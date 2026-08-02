import { describe, expect, test } from "bun:test";
import { resolveDotMatrix } from "../dot-matrix";
import { type GlyphTable, parseGlyphTable } from "../glyphs";

// U3 — label-to-matrix resolution (R6-R10). Pure, no DB, no React.
//
// The glyph table is a resolver parameter (KTD2), so every case below runs
// against a synthetic fixture rather than the (currently empty) shipped
// font. Shape of each glyph is irrelevant to this unit; only presence or
// absence of a character in the table matters.
const ALL_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-".split("");
const SAMPLE_ROW = "###";
const TEST_GLYPHS_RAW = ALL_CHARACTERS.map(
  (ch) =>
    `${ch} ${SAMPLE_ROW} ${SAMPLE_ROW} ${SAMPLE_ROW} ${SAMPLE_ROW} ${SAMPLE_ROW}`,
).join("\n");
const TEST_GLYPHS: GlyphTable = parseGlyphTable(TEST_GLYPHS_RAW);
const EMPTY_GLYPHS: GlyphTable = parseGlyphTable("");

// Real brandModel strings resolved through U2's actual MODEL_CELL_COUNTS —
// dot-matrix.ts calls resolveCellCount internally rather than taking a
// pre-resolved count (only the glyph table is injected, per KTD2).
const FOUR_CELL_MODEL = "Magpul PMAG 20 LR/SR GEN M3";
const TWO_CELL_MODEL = "Magpul PMAG 17 GL9";
const UNMATCHED_MODEL = "Some Unknown Brand 30rd";

describe("resolveDotMatrix", () => {
  test("covers AE6: owner mode off returns hidden, whatever the label", () => {
    expect(
      resolveDotMatrix({
        label: "US04",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: false,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({ kind: "hidden" });
  });

  test("covers AE7: empty label returns hidden", () => {
    expect(
      resolveDotMatrix({
        label: "",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({ kind: "hidden" });
  });

  test("a label of only whitespace returns hidden", () => {
    expect(
      resolveDotMatrix({
        label: "   ",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({ kind: "hidden" });
  });

  test("covers KTD3: a non-empty label with an empty glyph table returns hidden, not unrepresentable", () => {
    expect(
      resolveDotMatrix({
        label: "US04",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: EMPTY_GLYPHS,
      }),
    ).toEqual({ kind: "hidden" });
  });

  test("covers AE1: US04 on a 4-cell model renders U, S, 0, 4 with cellCountVerified true", () => {
    const result = resolveDotMatrix({
      label: "US04",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["U", "S", "0", "4"]);
    expect(result.cellCount).toBe(4);
    expect(result.cellCountVerified).toBe(true);
    expect(result.cells.length).toBe(4);
  });

  test("covers AE2: US04 on a 2-cell GL9 renders only 0, 4 — the prefix is dropped", () => {
    const result = resolveDotMatrix({
      label: "US04",
      brandModel: TWO_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["0", "4"]);
    expect(result.cellCount).toBe(2);
    expect(result.cellCountVerified).toBe(true);
  });

  test("covers AE3: AR12 on an unmatched model renders all four characters with cellCountVerified false", () => {
    const result = resolveDotMatrix({
      label: "AR12",
      brandModel: UNMATCHED_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["A", "R", "1", "2"]);
    expect(result.cellCount).toBe(4);
    expect(result.cellCountVerified).toBe(false);
  });

  test("covers AE4: AR-X on a 2-cell GL9 is unrepresentable — within the font but overflows with no trailing digit run", () => {
    expect(
      resolveDotMatrix({
        label: "AR-X",
        brandModel: TWO_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      cellCount: 2,
      cellCountVerified: true,
    });
  });

  test("covers AE5: A.1 is unrepresentable because '.' is absent from the font, even though the length would fit", () => {
    expect(
      resolveDotMatrix({
        label: "A.1",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      cellCount: 4,
      cellCountVerified: true,
    });
  });

  test("covers AE9: 1234 on a 2-cell GL9 is unrepresentable — the trailing digit run is the whole label and still overflows", () => {
    expect(
      resolveDotMatrix({
        label: "1234",
        brandModel: TWO_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      cellCount: 2,
      cellCountVerified: true,
    });
  });

  test("combined, no AE: an unmatched model whose label is unrepresentable returns cellCountVerified false", () => {
    // "A.1" is unrepresentable on any cell count because "." is absent from
    // the font (unlike AE4's "AR-X", which would fit an unmatched model's
    // 4-cell fallback and so is not a useful combined-case fixture here).
    expect(
      resolveDotMatrix({
        label: "A.1",
        brandModel: UNMATCHED_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      cellCount: 4,
      cellCountVerified: false,
    });
  });

  test("boundary R7/R8: a label exactly equal to the cell count renders every character", () => {
    const result = resolveDotMatrix({
      label: "AB12",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["A", "B", "1", "2"]);
  });

  test("boundary R8/R9: a trailing digit run exactly equal to the cell count renders that run", () => {
    const result = resolveDotMatrix({
      label: "AB12",
      brandModel: TWO_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["1", "2"]);
  });

  test("lowercase characters in a stored label are uppercased via normalizeMagpulLabel before resolution", () => {
    const result = resolveDotMatrix({
      label: "us04",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["U", "S", "0", "4"]);
  });
});
