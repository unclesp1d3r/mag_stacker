/**
 * CSV serializer (U8, parity §9 + dotnet-extensions §1). Pure — no DB, no Next.
 *
 * Exact parity column order; magazines only; serial is never a column (R45).
 * Formula-injection guard is applied BEFORE RFC-4180 quoting (apostrophe-first),
 * so a guarded value that also needs quoting is handled correctly (R46). LF line
 * endings; a trailing newline terminates every record (Go encoding/csv parity).
 */

export const CSV_HEADERS = [
  "Brand/Model",
  "Caliber",
  "Base Capacity",
  "Extension Rounds",
  "Effective Capacity",
  "Label",
  "Acquired Date",
  "Notes",
  "Compatible Firearms",
] as const;

export interface CsvMagazineRow {
  brandModel: string;
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
  label: string;
  /** `YYYY-MM-DD` or null/empty when unset. */
  acquiredDate: string | null;
  notes: string;
  /** Visible-resolved firearm names in ordinal order (R44, R17a). */
  compatibleFirearmNames: string[];
}

// Characters that, as a cell's first char, trigger the formula-injection guard.
const INJECTION_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

function guardAndQuote(value: string): string {
  let v = value;
  if (v.length > 0 && INJECTION_PREFIXES.has(v[0])) {
    v = `'${v}`; // apostrophe first (dotnet-extensions §1)
  }
  if (/[",\r\n]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`; // RFC-4180 quote with doubled quotes
  }
  return v;
}

function toRecord(cells: string[]): string {
  return cells.map(guardAndQuote).join(",");
}

/**
 * Serialize visible magazines to RFC-4180 CSV. An empty list emits exactly one
 * header row (R47).
 */
export function serializeMagazinesCsv(rows: CsvMagazineRow[]): string {
  const records = [toRecord([...CSV_HEADERS])];
  for (const r of rows) {
    records.push(
      toRecord([
        r.brandModel,
        r.caliber,
        String(r.baseCapacity),
        String(r.extensionRounds),
        String(r.baseCapacity + r.extensionRounds),
        r.label,
        r.acquiredDate ?? "",
        r.notes,
        r.compatibleFirearmNames.join("; "),
      ]),
    );
  }
  // Trailing newline after every record (incl. the last), matching Go's writer.
  return `${records.join("\n")}\n`;
}
