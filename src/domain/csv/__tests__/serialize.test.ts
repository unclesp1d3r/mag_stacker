import { describe, expect, test } from "bun:test";
import { type CsvMagazineRow, serializeMagazinesCsv } from "../serialize";

const HEADER =
  "Brand/Model,Caliber,Base Capacity,Extension Rounds,Effective Capacity,Label,Acquired Date,Notes,Compatible Firearms";

function row(overrides: Partial<CsvMagazineRow> = {}): CsvMagazineRow {
  return {
    brandModel: "PMAG",
    caliber: "9mm",
    baseCapacity: 15,
    extensionRounds: 2,
    label: "",
    acquiredDate: null,
    notes: "",
    compatibleFirearmNames: [],
    ...overrides,
  };
}

function lines(csv: string): string[] {
  return csv.split("\n").filter((l) => l.length > 0);
}

describe("serializeMagazinesCsv (parity §9 + injection guard)", () => {
  test("first line is the exact parity header; serial is never a column", () => {
    const csv = serializeMagazinesCsv([]);
    expect(lines(csv)[0]).toBe(HEADER);
    expect(HEADER.split(",")).toHaveLength(9);
    expect(HEADER).not.toContain("Serial");
  });

  test("covers AE10: empty inventory emits exactly one header row, no data rows", () => {
    const csv = serializeMagazinesCsv([]);
    expect(lines(csv)).toEqual([HEADER]);
    expect(csv).toBe(`${HEADER}\n`);
  });

  test("covers AE2: base 15 + extension 2 reports effective capacity 17", () => {
    const csv = serializeMagazinesCsv([
      row({ baseCapacity: 15, extensionRounds: 2 }),
    ]);
    const cells = lines(csv)[1].split(",");
    expect(cells[2]).toBe("15"); // base
    expect(cells[3]).toBe("2"); // extension
    expect(cells[4]).toBe("17"); // effective (computed)
  });

  test("covers AE9: a notes value beginning with = is apostrophe-prefixed", () => {
    const csv = serializeMagazinesCsv([row({ notes: "=SUM(A1)" })]);
    expect(lines(csv)[1].split(",")[7]).toBe("'=SUM(A1)");
  });

  test("the injection guard covers =, +, -, @, tab, and CR as first char", () => {
    for (const ch of ["=", "+", "-", "@", "\t"]) {
      const csv = serializeMagazinesCsv([row({ brandModel: `${ch}danger` })]);
      expect(lines(csv)[1].startsWith(`'${ch}danger`)).toBe(true);
    }
  });

  test("compatible firearms join with '; ' in ordinal order", () => {
    const csv = serializeMagazinesCsv([
      row({ compatibleFirearmNames: ["Glock 19", "Glock 45"] }),
    ]);
    expect(lines(csv)[1].split(",").slice(8).join(",")).toContain(
      "Glock 19; Glock 45",
    );
  });

  test("RFC-4180: a field with comma/quote is quoted with internal quotes doubled", () => {
    const csv = serializeMagazinesCsv([
      row({ brandModel: 'Brand, "Special"' }),
    ]);
    expect(lines(csv)[1].startsWith('"Brand, ""Special"""')).toBe(true);
  });

  test("a guarded value that also contains a comma is both apostrophe-prefixed and quoted", () => {
    const csv = serializeMagazinesCsv([row({ notes: "=A,B" })]);
    // notes is column 7
    expect(csv).toContain('"\'=A,B"');
  });

  test("an embedded newline in notes is quoted", () => {
    const csv = serializeMagazinesCsv([row({ notes: "line1\nline2" })]);
    expect(csv).toContain('"line1\nline2"');
  });

  test("AcquiredDate renders YYYY-MM-DD, or empty when unset", () => {
    const withDate = serializeMagazinesCsv([
      row({ acquiredDate: "2026-06-14" }),
    ]);
    expect(lines(withDate)[1].split(",")[6]).toBe("2026-06-14");
    const noDate = serializeMagazinesCsv([row({ acquiredDate: null })]);
    expect(noDate.split("\n")[1].split(",")[6]).toBe("");
  });
});
