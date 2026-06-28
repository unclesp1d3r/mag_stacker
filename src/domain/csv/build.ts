import { listFirearms } from "@/src/domain/firearms/service";
import { listMagazines } from "@/src/domain/magazines/service";
import { type CsvMagazineRow, serializeMagazinesCsv } from "./serialize";

/**
 * Build the inventory CSV for a requester (U8). Loads the viewer-relative
 * visible magazines and firearms, resolves compatible-firearm ids to names in
 * ordinal order (silently omitting any not visible — R44/R17a), and serializes.
 */
export async function buildInventoryCsv(actorId: string): Promise<string> {
  const [firearms, magazines] = await Promise.all([
    listFirearms(actorId),
    listMagazines(actorId),
  ]);
  const nameById = new Map(firearms.map((f) => [f.id, f.name]));

  const rows: CsvMagazineRow[] = magazines.map((m) => ({
    brandModel: m.brandModel,
    caliber: m.caliber,
    baseCapacity: m.baseCapacity,
    extensionRounds: m.extensionRounds,
    label: m.label,
    acquiredDate: m.acquiredDate,
    notes: m.notes,
    compatibleFirearmNames: m.compatibleFirearmIds
      .map((id) => nameById.get(id))
      .filter((name): name is string => name !== undefined),
  }));

  return serializeMagazinesCsv(rows);
}
