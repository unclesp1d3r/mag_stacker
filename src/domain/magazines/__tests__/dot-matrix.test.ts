import { describe, expect, test } from "bun:test";
import { resolveDotMatrix } from "../dot-matrix";
import {
  type GlyphCell,
  type GlyphTable,
  MAGPUL_GLYPHS,
  parseGlyphTable,
} from "../glyphs";

// U3 — label-to-matrix resolution (R6-R10). Pure, no DB, no React.
//
// The glyph table is a resolver parameter (KTD2), so the cases below run
// against a synthetic fixture that deliberately contains *more* characters
// than Magpul's sheet (a hyphen among them). That isolates each rule from
// font coverage: only presence or absence of a character in the table
// matters here, not glyph shape.
//
// The second describe block re-runs the acceptance examples against the real
// shipped MAGPUL_GLYPHS, which is what actually renders. The two tables
// disagree wherever a label uses a character Magpul never drew — exactly the
// hyphen case — so a rule proven only against the fixture is not proven.
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

  test("covers AE4: AR-X on a 2-cell GL9 does not fit — every character is in this fixture's font, but four of them overflow two cells with no trailing digit run", () => {
    expect(
      resolveDotMatrix({
        label: "AR-X",
        brandModel: TWO_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "doesNotFit",
      cellCount: 2,
      cellCountVerified: true,
    });
  });

  test("covers AE5 (R9a): A.1 drops the unpaintable '.' and renders A, 1, naming what was left out", () => {
    const result = resolveDotMatrix({
      label: "A.1",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["A", "1"]);
    expect(result.omitted).toEqual(["."]);
  });

  test("R9a: a label whose characters are ALL outside the font is unrepresentable — there is nothing left to paint", () => {
    expect(
      resolveDotMatrix({
        label: "..",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "unsupportedCharacter",
      cellCount: 4,
      cellCountVerified: true,
    });
  });

  test("R9a: dropping happens before the length check, so a label that only fits once stripped renders in full", () => {
    // "A.B.C.D" is 7 characters stored but only 4 paintable, so it fits a
    // 4-cell floorplate exactly. Measuring the stored label would have sent
    // this down the overflow path and drawn nothing.
    const result = resolveDotMatrix({
      label: "A.B.C.D",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["A", "B", "C", "D"]);
  });

  test("R9a: repeated unpaintable characters are reported once, in first-seen order", () => {
    const result = resolveDotMatrix({
      label: "A.B?.",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.omitted).toEqual([".", "?"]);
  });

  test("R9a: once R8 drops a prefix, omitted is empty — the accessible name already states exactly what is drawn", () => {
    const result = resolveDotMatrix({
      label: "A.12",
      brandModel: TWO_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: TEST_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["1", "2"]);
    expect(result.omitted).toEqual([]);
  });

  test("covers AE9: 1234 on a 2-cell GL9 does not fit — the trailing digit run is the whole label and still overflows", () => {
    expect(
      resolveDotMatrix({
        label: "1234",
        brandModel: TWO_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "doesNotFit",
      cellCount: 2,
      cellCountVerified: true,
    });
  });

  test("combined, no AE: an unmatched model whose label cannot be drawn returns cellCountVerified false", () => {
    // Five letters overflow the unmatched model's 4-cell fallback and have no
    // trailing digit run to fall back to, so this reaches `doesNotFit` while
    // still carrying the unverified flag — the pairing R9 specifies but no
    // acceptance example exercises.
    expect(
      resolveDotMatrix({
        label: "ABCDE",
        brandModel: UNMATCHED_MODEL,
        ownerMagpulMode: true,
        glyphs: TEST_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "doesNotFit",
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

/**
 * The same rules against the font that actually ships.
 *
 * The synthetic fixture above holds a hyphen; Magpul's sheet does not. Every
 * case where those two disagree is a case the fixture cannot prove, and the
 * hyphen is not hypothetical — #21's validator permits it in a stored label,
 * so `A-1` is ordinary user data, not legacy junk.
 */
/** The shipped cell for `character`, failing loudly rather than comparing
 * against `undefined` if the font ever stops carrying it. */
function shippedCell(character: string): GlyphCell {
  const cell = MAGPUL_GLYPHS.get(character);
  if (!cell) {
    throw new Error(`MAGPUL_GLYPHS is missing "${character}"`);
  }
  return cell;
}

describe("resolveDotMatrix against the shipped MAGPUL_GLYPHS", () => {
  test("AE1: US04 on a 4-cell PMAG draws the real transcribed cell for each character", () => {
    const result = resolveDotMatrix({
      label: "US04",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: MAGPUL_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["U", "S", "0", "4"]);
    expect(result.omitted).toEqual([]);
    // Identity against the parsed font, so a resolver that returned cells for
    // the wrong characters (or in the wrong order) fails here.
    expect(result.cells).toEqual([
      shippedCell("U"),
      shippedCell("S"),
      shippedCell("0"),
      shippedCell("4"),
    ]);
  });

  test("AE2: US04 on a 2-cell GL9 draws only the real 0 and 4 cells", () => {
    const result = resolveDotMatrix({
      label: "US04",
      brandModel: TWO_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: MAGPUL_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.cells).toEqual([shippedCell("0"), shippedCell("4")]);
  });

  test("AE3: an unmatched model labeled AR12 renders all four characters, unverified", () => {
    const result = resolveDotMatrix({
      label: "AR12",
      brandModel: UNMATCHED_MODEL,
      ownerMagpulMode: true,
      glyphs: MAGPUL_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["A", "R", "1", "2"]);
    expect(result.cellCountVerified).toBe(false);
  });

  test("R9a: a hyphenated label drops the hyphen and paints the rest — the sheet has no hyphen glyph", () => {
    const result = resolveDotMatrix({
      label: "A-1",
      brandModel: FOUR_CELL_MODEL,
      ownerMagpulMode: true,
      glyphs: MAGPUL_GLYPHS,
    });
    expect(result.kind).toBe("matrix");
    if (result.kind !== "matrix") throw new Error("expected matrix");
    expect(result.characters).toEqual(["A", "1"]);
    expect(result.omitted).toEqual(["-"]);
  });

  test("AE4 against the real font: AR-X on a 2-cell GL9 strips to ARX, which still overflows", () => {
    // Diverges from the fixture run above, and that divergence is the point:
    // there the hyphen counted toward the length, here it never existed.
    // Either way the label cannot be drawn, but by a different rule.
    expect(
      resolveDotMatrix({
        label: "AR-X",
        brandModel: TWO_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: MAGPUL_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "doesNotFit",
      cellCount: 2,
      cellCountVerified: true,
    });
  });

  test("R9a: a label of nothing but hyphens is unrepresentable against the real font", () => {
    expect(
      resolveDotMatrix({
        label: "--",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: MAGPUL_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "unsupportedCharacter",
      cellCount: 4,
      cellCountVerified: true,
    });
  });

  test("AE9: 1234 on a 2-cell GL9 does not fit against the real font either", () => {
    expect(
      resolveDotMatrix({
        label: "1234",
        brandModel: TWO_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: MAGPUL_GLYPHS,
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "doesNotFit",
      cellCount: 2,
      cellCountVerified: true,
    });
  });

  test("AE6/AE7: mode off and an empty label are hidden regardless of which font is in play", () => {
    expect(
      resolveDotMatrix({
        label: "US04",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: false,
        glyphs: MAGPUL_GLYPHS,
      }),
    ).toEqual({ kind: "hidden" });
    expect(
      resolveDotMatrix({
        label: "",
        brandModel: FOUR_CELL_MODEL,
        ownerMagpulMode: true,
        glyphs: MAGPUL_GLYPHS,
      }),
    ).toEqual({ kind: "hidden" });
  });

  test("every character #21 permits in a label either has a glyph or is the hyphen", () => {
    // Pins the exact overlap between what the validator accepts and what the
    // font can draw. If #21 ever widens its character set, this fails and
    // forces a decision about the new character instead of letting it
    // silently disappear from every rendered pattern.
    const permitted = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-"];
    const withoutGlyph = permitted.filter(
      (character) => !MAGPUL_GLYPHS.has(character),
    );
    expect(withoutGlyph).toEqual(["-"]);
  });
});
