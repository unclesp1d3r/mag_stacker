import { describe, expect, test } from "bun:test";
import { type CsvAmmoRow, serializeAmmoCsv } from "../ammo-serialize";

const HEADER =
  "Brand,Caliber,Type,Grain,Quantity Rounds,Low Stock Threshold,Low Stock,Acquired Date,Notes";

function row(overrides: Partial<CsvAmmoRow> = {}): CsvAmmoRow {
  return {
    brand: "Test Ammo Co",
    caliber: "9mm",
    type: "FMJ",
    grain: 115,
    quantityRounds: 100,
    lowStockThreshold: 20,
    acquiredDate: null,
    notes: "",
    ...overrides,
  };
}

function lines(csv: string): string[] {
  return csv.split("\n").filter((l) => l.length > 0);
}

describe("serializeAmmoCsv (ammo plan U6, R15 + injection guard parity)", () => {
  test("first line is the exact header", () => {
    const csv = serializeAmmoCsv([]);
    expect(lines(csv)[0]).toBe(HEADER);
    expect(HEADER.split(",")).toHaveLength(9);
  });

  test("an empty list emits exactly one header row and a trailing newline", () => {
    const csv = serializeAmmoCsv([]);
    expect(lines(csv)).toEqual([HEADER]);
    expect(csv).toBe(`${HEADER}\n`);
  });

  test("a low lot (quantity <= threshold) serializes Low Stock = Yes", () => {
    const csv = serializeAmmoCsv([
      row({ quantityRounds: 10, lowStockThreshold: 20 }),
    ]);
    expect(lines(csv)[1].split(",")[6]).toBe("Yes");
  });

  test("an above-threshold lot serializes Low Stock = No", () => {
    const csv = serializeAmmoCsv([
      row({ quantityRounds: 30, lowStockThreshold: 20 }),
    ]);
    expect(lines(csv)[1].split(",")[6]).toBe("No");
  });

  test("boundary: quantity == threshold serializes Low Stock = Yes", () => {
    const csv = serializeAmmoCsv([
      row({ quantityRounds: 20, lowStockThreshold: 20 }),
    ]);
    expect(lines(csv)[1].split(",")[6]).toBe("Yes");
  });

  test("the injection guard covers =, +, -, @, and tab as first char in brand", () => {
    for (const ch of ["=", "+", "-", "@", "\t"]) {
      const csv = serializeAmmoCsv([row({ brand: `${ch}danger` })]);
      expect(lines(csv)[1].startsWith(`'${ch}danger`)).toBe(true);
    }
  });

  test("the injection guard covers =, +, -, @, and tab as first char in notes", () => {
    for (const ch of ["=", "+", "-", "@", "\t"]) {
      const csv = serializeAmmoCsv([row({ notes: `${ch}danger` })]);
      const notesCell = lines(csv)[1].split(",").slice(8).join(",");
      expect(notesCell.startsWith(`'${ch}danger`)).toBe(true);
    }
  });

  // CR is both an injection-guard prefix AND an RFC-4180 quote trigger (it is
  // an embedded control char), so the apostrophe-guarded value is *also*
  // wrapped in quotes — apostrophe-guard-before-quote (R46), applied here.
  test("a CR-prefixed brand is apostrophe-guarded then RFC-4180 quoted", () => {
    const csv = serializeAmmoCsv([row({ brand: "\rdanger" })]);
    expect(csv).toContain('"\'\rdanger"');
  });

  test("a CR-prefixed notes value is apostrophe-guarded then RFC-4180 quoted", () => {
    const csv = serializeAmmoCsv([row({ notes: "\rdanger" })]);
    expect(csv).toContain('"\'\rdanger"');
  });

  test("RFC-4180: a field with comma/quote is quoted with internal quotes doubled", () => {
    const csv = serializeAmmoCsv([row({ brand: 'Brand, "Special"' })]);
    expect(lines(csv)[1].startsWith('"Brand, ""Special"""')).toBe(true);
  });

  test("an embedded newline in notes is quoted", () => {
    const csv = serializeAmmoCsv([row({ notes: "line1\nline2" })]);
    expect(csv).toContain('"line1\nline2"');
  });

  test("a guarded value that also contains a comma is both apostrophe-prefixed and quoted", () => {
    const csv = serializeAmmoCsv([row({ notes: "=A,B" })]);
    expect(csv).toContain('"\'=A,B"');
  });

  test("numeric columns serialize as plain integers", () => {
    const csv = serializeAmmoCsv([
      row({ grain: 115, quantityRounds: 500, lowStockThreshold: 50 }),
    ]);
    const cells = lines(csv)[1].split(",");
    expect(cells[3]).toBe("115"); // grain
    expect(cells[4]).toBe("500"); // quantityRounds
    expect(cells[5]).toBe("50"); // lowStockThreshold
  });

  test("AcquiredDate renders YYYY-MM-DD, or empty when unset", () => {
    const withDate = serializeAmmoCsv([row({ acquiredDate: "2026-06-14" })]);
    expect(lines(withDate)[1].split(",")[7]).toBe("2026-06-14");
    const noDate = serializeAmmoCsv([row({ acquiredDate: null })]);
    expect(lines(noDate)[0]).toBe(HEADER); // sanity: header unaffected
    expect(noDate.split("\n")[1].split(",")[7]).toBe("");
  });
});
