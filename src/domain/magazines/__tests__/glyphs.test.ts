import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAGPUL_GLYPHS_RAW } from "@/src/data/raw";
import { type GlyphTable, MAGPUL_GLYPHS, parseGlyphTable } from "../glyphs";

const GLYPHS_TXT_PATH = path.join(process.cwd(), "src/data/magpul-glyphs.txt");

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

  test("throws when the glyph key is a lowercase letter", () => {
    const raw = "a ### ### ### ### ###";
    expect(() => parseGlyphTable(raw)).toThrow();
  });

  test("throws when the glyph key is punctuation outside the font", () => {
    const raw = ". ### ### ### ### ###";
    expect(() => parseGlyphTable(raw)).toThrow();
  });

  test("parses a digit glyph key", () => {
    const raw = "7 ### #.# #.# #.# ###";
    const table = parseGlyphTable(raw);
    expect(table.has("7")).toBe(true);
  });

  test("parses an uppercase letter glyph key", () => {
    const raw = "Z ### #.# #.# #.# ###";
    const table = parseGlyphTable(raw);
    expect(table.has("Z")).toBe(true);
  });

  test("parses the hyphen glyph key", () => {
    const raw = "- ### #.# #.# #.# ###";
    const table = parseGlyphTable(raw);
    expect(table.has("-")).toBe(true);
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

  test("the shipped src/data/magpul-glyphs.txt matches the embedded MAGPUL_GLYPHS_RAW and parses without throwing", () => {
    // `MAGPUL_GLYPHS_RAW` in src/data/raw.ts is a hand-maintained copy of
    // src/data/magpul-glyphs.txt (raw.ts exists so the fixture loads without
    // filesystem access in the Next bundle, standalone output, and Docker —
    // see its header comment). Nothing regenerates raw.ts from the .txt file,
    // so editing one and forgetting the other would silently ship the old
    // embedded string while the .txt file on disk (and in review) shows the
    // edit. Reading the .txt file directly is what catches that drift; parsing
    // only `MAGPUL_GLYPHS_RAW` (as the previous version of this test did)
    // would pass even when the two have diverged.
    const onDisk = readFileSync(GLYPHS_TXT_PATH, "utf8");

    expect(onDisk).toBe(MAGPUL_GLYPHS_RAW);
    expect(() => parseGlyphTable(onDisk)).not.toThrow();
  });
});

/**
 * The independently-recorded shape of every glyph on Magpul's sheet, in the
 * sheet's own order (digits `1`-`9` then `0`, then `A`-`Z`).
 *
 * This is the point of the whole test file. `magpul-glyphs.txt` was produced
 * by rendering Magpul's PDF at 300 DPI, recovering the dot lattice, and
 * sampling all 600 positions; the result was then checked against the sheet
 * by eye and confirmed correct. Without this table, a row shift or a bad crop
 * in any single letter would pass every other assertion here — the fixture
 * would still parse, still hold 36 entries, and still render *something*.
 * The consequence of a wrong glyph is not a failed render: it is an owner
 * putting a permanent paint mark on hardware in the wrong pattern.
 *
 * Kept in the sheet's ordering rather than the fixture's so the two are not
 * trivially diffable line-for-line — a regeneration that shifts rows has to
 * survive a comparison written from the source, not from the artifact.
 */
const EXPECTED_GLYPHS: Readonly<Record<string, string>> = {
  "1": "##.|.#.|.#.|.#.|###",
  "2": "###|..#|###|#..|###",
  "3": "###|..#|###|..#|###",
  "4": "#.#|#.#|###|..#|..#",
  "5": "###|#..|###|..#|###",
  "6": "###|#..|###|#.#|###",
  "7": "###|..#|..#|..#|..#",
  "8": "###|#.#|###|#.#|###",
  "9": "###|#.#|###|..#|..#",
  "0": "###|#.#|#.#|#.#|###",
  A: "###|#.#|###|#.#|#.#",
  B: "##.|#.#|##.|#.#|##.",
  C: "###|#..|#..|#..|###",
  D: "##.|#.#|#.#|#.#|##.",
  E: "###|#..|###|#..|###",
  F: "###|#..|###|#..|#..",
  G: ".##|#..|###|#.#|.#.",
  H: "#.#|#.#|###|#.#|#.#",
  I: "###|.#.|.#.|.#.|###",
  J: "..#|..#|..#|#.#|.#.",
  K: "#.#|#.#|##.|#.#|#.#",
  L: "#..|#..|#..|#..|###",
  M: "#.#|###|#.#|#.#|#.#",
  N: "##.|#.#|#.#|#.#|#.#",
  O: ".#.|#.#|#.#|#.#|.#.",
  P: "###|#.#|###|#..|#..",
  Q: "###|#.#|#.#|###|..#",
  R: "###|#.#|##.|#.#|#.#",
  S: "###|#..|###|..#|###",
  T: "###|.#.|.#.|.#.|.#.",
  U: "#.#|#.#|#.#|#.#|###",
  V: "#.#|#.#|#.#|#.#|.#.",
  W: "#.#|#.#|#.#|###|#.#",
  X: "#.#|#.#|.#.|#.#|#.#",
  Y: "#.#|#.#|.#.|.#.|.#.",
  Z: "###|..#|.#.|#..|###",
};

/** `"###|#.#"` -> `[[true,true,true],[true,false,true]]`. */
function toCell(pattern: string): boolean[][] {
  return pattern.split("|").map((row) => [...row].map((mark) => mark === "#"));
}

describe("MAGPUL_GLYPHS", () => {
  test("covers every character in 0-9 and A-Z, and carries no hyphen (the transcribed Magpul sheet has 36 glyphs, no punctuation)", () => {
    const table: GlyphTable = MAGPUL_GLYPHS;

    const expectedCharacters = [
      ..."0123456789",
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ];

    expect(table.size).toBe(36);
    for (const character of expectedCharacters) {
      expect(table.has(character)).toBe(true);
    }
    expect(table.has("-")).toBe(false);
  });

  test("the expected table itself covers all 36 characters, so a deleted row cannot quietly shrink the guard below", () => {
    // Without this, dropping an entry from EXPECTED_GLYPHS would silently
    // stop checking that glyph while every assertion still passed.
    expect(Object.keys(EXPECTED_GLYPHS).sort().join("")).toBe(
      [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].sort().join(""),
    );
  });

  for (const [character, pattern] of Object.entries(EXPECTED_GLYPHS)) {
    test(`glyph "${character}" matches the transcribed Magpul pattern exactly`, () => {
      expect(MAGPUL_GLYPHS.get(character)).toEqual(toCell(pattern));
    });
  }
});
