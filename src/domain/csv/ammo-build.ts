import { listAmmo } from "@/src/domain/ammo/service";
import { type CsvAmmoRow, serializeAmmoCsv } from "./ammo-serialize";

/**
 * Build the ammo CSV for a requester (ammo plan U6). Loads the
 * viewer-relative visible ammo lots and serializes them, including the
 * computed low-stock status column.
 */
export async function buildAmmoCsv(actorId: string): Promise<string> {
  const lots = await listAmmo(actorId);

  const rows: CsvAmmoRow[] = lots.map((a) => ({
    brand: a.brand,
    caliber: a.caliber,
    type: a.type,
    grain: a.grain,
    quantityRounds: a.quantityRounds,
    lowStockThreshold: a.lowStockThreshold,
    acquiredDate: a.acquiredDate,
    notes: a.notes,
  }));

  return serializeAmmoCsv(rows);
}
