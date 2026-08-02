import { describe, expect, test } from "bun:test";
import { MAGPUL_GLYPHS_RAW } from "@/src/data/raw";
import { type GlyphTable, MAGPUL_GLYPHS, parseGlyphTable } from "../glyphs";

// U1 — glyph table fixture and loader (R1, R2). Pure, no DB, no React.
describe("parseGlyphTable", () => {
  test("parses a well-formed three-glyph table into a lookup keyed by character", () => {
    const raw = [
      "0 ### #.# #.# #.# ###",
      "1 .#. .#. .#. .#. .#.",
      "A ### #.# ### #.# #.#",
    ].join("\n");

    const table = parseGlyphTable(raw);

    expect(table.size).toBe(3);
    expect(table.get("0")).toEqual([
      [true, true, true],
      [true, false, true],
      [true, false, true],
      [true, false, true],
      [true, true, true],
    ]);
    expect(table.get("1")).toEqual([
      [false, true, false],
      [false, true, false],
      [false, true, false],
      [false, true, false],
      [false, true, false],
    ]);
    expect(table.get("A")).toEqual([
      [true, true, true],
      [true, false, true],
      [true, true, true],
      [true, false, true],
      [true, false, true],
    ]);
  });

  test("throws when a glyph row has four columns instead of three", () => {
    const raw = "0 ###. #.# #.# #.# ###";
    expect(() => parseGlyphTable(raw)).toThrow();
  });

  test("throws when a glyph declares four rows instead of five", () => {
    const raw = "0 ### #.# #.# ###";
    expect(() => parseGlyphTable(raw)).toThrow();
  });

  test("throws when a row contains a character other than # or .", () => {
    const raw = "0 ### #x# #.# #.# ###";
    expect(() => parseGlyphTable(raw)).toThrow();
  });

  test("throws when the same glyph character is declared twice", () => {
    const raw = ["0 ### #.# #.# #.# ###", "0 ### #.# #.# #.# ###"].join("\n");
    expect(() => parseGlyphTable(raw)).toThrow();
  });

  test("throws when the leading field is not a single character", () => {
    const raw = "AB ### ### ### ### ###";
    expect(() => parseGlyphTable(raw)).toThrow();
  });

  test("parses correctly when fields are separated by multiple spaces", () => {
    const raw = "0  ###  #.#  #.#  #.#  ###";
    const table = parseGlyphTable(raw);
    expect(table.get("0")).toEqual([
      [true, true, true],
      [true, false, true],
      [true, false, true],
      [true, false, true],
      [true, true, true],
    ]);
  });

  test("parses correctly with CRLF line endings", () => {
    const raw = ["0 ### #.# #.# #.# ###", "1 .#. .#. .#. .#. .#."].join("\r\n");

    const table = parseGlyphTable(raw);

    expect(table.size).toBe(2);
    expect(table.get("0")).toEqual([
      [true, true, true],
      [true, false, true],
      [true, false, true],
      [true, false, true],
      [true, true, true],
    ]);
    expect(table.get("1")).toEqual([
      [false, true, false],
      [false, true, false],
      [false, true, false],
      [false, true, false],
      [false, true, false],
    ]);
  });

  test("returns an empty table for input that is entirely comments and blank lines", () => {
    const raw = ["# a comment", "", "   ", "# another comment"].join("\n");
    const table = parseGlyphTable(raw);
    expect(table.size).toBe(0);
  });

  test("the shipped src/data/magpul-glyphs.txt parses without throwing", () => {
    expect(() => parseGlyphTable(MAGPUL_GLYPHS_RAW)).not.toThrow();
  });
});

describe("MAGPUL_GLYPHS", () => {
  test("is empty until the diagram is transcribed — ships dark (KTD3)", () => {
    const table: GlyphTable = MAGPUL_GLYPHS;
    expect(table.size).toBe(0);
  });
});
