/**
 * Ammo CSV serializer (ammo plan U6, R15). Pure — no DB, no Next.
 *
 * Mirrors `serialize.ts` exactly: apostrophe-first formula-injection guard
 * applied BEFORE RFC-4180 quoting, LF line endings, a trailing newline after
 * every record, and an empty list emits exactly one header row. `Low Stock`
 * is derived via `isLowStock` (single source of truth, R9/R10) rather than
 * re-computed here.
 */

import { isLowStock } from "@/src/domain/ammo/validate";
import { toRecord } from "./csv-cell";

export const CSV_AMMO_HEADERS = [
  "Brand",
  "Caliber",
  "Type",
  "Grain",
  "Quantity Rounds",
  "Low Stock Threshold",
  "Low Stock",
  "Acquired Date",
  "Notes",
] as const;

export interface CsvAmmoRow {
  brand: string;
  caliber: string;
  type: string;
  grain: number;
  quantityRounds: number;
  lowStockThreshold: number;
  /** `YYYY-MM-DD` or null/empty when unset. */
  acquiredDate: string | null;
  notes: string;
}

/**
 * Serialize visible ammo lots to RFC-4180 CSV. An empty list emits exactly
 * one header row (parity with `serializeMagazinesCsv`).
 */
export function serializeAmmoCsv(rows: CsvAmmoRow[]): string {
  const records = [toRecord([...CSV_AMMO_HEADERS])];
  for (const r of rows) {
    records.push(
      toRecord([
        r.brand,
        r.caliber,
        r.type,
        String(r.grain),
        String(r.quantityRounds),
        String(r.lowStockThreshold),
        isLowStock(r) ? "Yes" : "No",
        r.acquiredDate ?? "",
        r.notes,
      ]),
    );
  }
  // Trailing newline after every record (incl. the last), matching Go's writer.
  return `${records.join("\n")}\n`;
}
