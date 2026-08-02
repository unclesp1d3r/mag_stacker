import { describe, expect, test } from "bun:test";
import {
  FALLBACK_CELL_COUNT,
  MODEL_CELL_COUNTS,
  normalizeModel,
  resolveCellCount,
} from "../floorplate";

// U2 — floorplate cell-count lookup (R3, R4, R5). Pure, no DB, no React.
describe("resolveCellCount", () => {
  test('"Magpul PMAG 17 GL9" resolves to 2 cells, matched', () => {
    expect(resolveCellCount("Magpul PMAG 17 GL9")).toEqual({
      cells: 2,
      matched: true,
    });
  });

  test('"magpul pmag 15 gl9" resolves to 2 cells, matched — case-insensitive', () => {
    expect(resolveCellCount("magpul pmag 15 gl9")).toEqual({
      cells: 2,
      matched: true,
    });
  });

  test('"Magpul GL9" resolves to 2 cells, matched — the PMAG-less shorthand regression guard', () => {
    expect(resolveCellCount("Magpul GL9")).toEqual({
      cells: 2,
      matched: true,
    });
  });

  test('"Magpul PMAG 20 LR/SR GEN M3" resolves to 4 cells, matched — a 4-cell model is a match, not a fallback', () => {
    expect(resolveCellCount("Magpul PMAG 20 LR/SR GEN M3")).toEqual({
      cells: 4,
      matched: true,
    });
  });

  test('"Magpul PMAG 25 7.62x51" resolves to 4 cells, matched via the caliber entry', () => {
    expect(resolveCellCount("Magpul PMAG 25 7.62x51")).toEqual({
      cells: 4,
      matched: true,
    });
  });

  test('"Some Unknown Brand 30rd" resolves to 4 cells, unmatched', () => {
    expect(resolveCellCount("Some Unknown Brand 30rd")).toEqual({
      cells: FALLBACK_CELL_COUNT,
      matched: false,
    });
  });

  test('"" and "   " resolve to 4 cells, unmatched, without throwing', () => {
    expect(resolveCellCount("")).toEqual({
      cells: FALLBACK_CELL_COUNT,
      matched: false,
    });
    expect(resolveCellCount("   ")).toEqual({
      cells: FALLBACK_CELL_COUNT,
      matched: false,
    });
  });

  test('"Magpul  P-MAG   17  GL9" still matches the GL9 entry — punctuation and extra whitespace are stripped', () => {
    expect(resolveCellCount("Magpul  P-MAG   17  GL9")).toEqual({
      cells: 2,
      matched: true,
    });
  });

  test("every entry in MODEL_CELL_COUNTS has at least one token and a positive cell count", () => {
    expect(MODEL_CELL_COUNTS.length).toBeGreaterThan(0);
    for (const entry of MODEL_CELL_COUNTS) {
      expect(entry.tokens.length).toBeGreaterThan(0);
      for (const token of entry.tokens) {
        expect(token.length).toBeGreaterThan(0);
      }
      expect(entry.cells).toBeGreaterThan(0);
    }
  });
});

describe("normalizeModel", () => {
  test("uppercases and strips every character outside A-Z0-9", () => {
    expect(normalizeModel("Magpul PMAG 17 GL9")).toBe("MAGPULPMAG17GL9");
    expect(normalizeModel("Magpul PMAG 25 7.62x51")).toBe("MAGPULPMAG25762X51");
  });
});
