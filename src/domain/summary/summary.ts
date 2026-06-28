import { listFirearms } from "@/src/domain/firearms/service";
import { listMagazines } from "@/src/domain/magazines/service";
import { effectiveCapacity } from "@/src/domain/magazines/validate";

/**
 * Inventory summary (U7, parity §7). Computed in memory over the requester's
 * VISIBLE inventory snapshot only (R41). The pure `computeSummary` is the parity
 * aggregation; `inventorySummary` loads the viewer-relative snapshot and applies
 * it. Empty inventory yields an all-zero summary, never null (R68).
 */

export interface FirearmIdentity {
  id: string;
  name: string;
}

export interface MagazineSnapshot {
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
  /** Viewer-relative: unseen firearm references are already dropped (R17a). */
  compatibleFirearmIds: string[];
}

export interface CaliberSummary {
  caliber: string;
  count: number;
  effectiveCapacity: number;
}

export interface FirearmCount {
  id: string;
  name: string;
  count: number;
}

export interface Summary {
  totalMagazines: number;
  /** One row per caliber, sorted alphabetically by caliber (R42). */
  byCaliber: CaliberSummary[];
  /** One row per firearm (incl. zero-count), sorted alphabetically by name (R42). */
  firearmCounts: FirearmCount[];
}

/**
 * Pure aggregation (parity §7.2). Keyed by firearm IDENTITY (id), not name, so
 * two same-named firearms stay distinct (R39). A magazine referencing a firearm
 * absent from `firearms` still counts toward totals/per-caliber but yields no
 * phantom per-firearm entry (R40).
 */
export function computeSummary(
  firearms: FirearmIdentity[],
  magazines: MagazineSnapshot[],
): Summary {
  const countByCaliber = new Map<string, number>();
  const effectiveByCaliber = new Map<string, number>();
  const countByFirearmId = new Map<string, number>();

  for (const mag of magazines) {
    countByCaliber.set(mag.caliber, (countByCaliber.get(mag.caliber) ?? 0) + 1);
    effectiveByCaliber.set(
      mag.caliber,
      (effectiveByCaliber.get(mag.caliber) ?? 0) + effectiveCapacity(mag),
    );
    for (const firearmId of mag.compatibleFirearmIds) {
      countByFirearmId.set(
        firearmId,
        (countByFirearmId.get(firearmId) ?? 0) + 1,
      );
    }
  }

  const byCaliber: CaliberSummary[] = [...countByCaliber.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((caliber) => ({
      caliber,
      count: countByCaliber.get(caliber) ?? 0,
      effectiveCapacity: effectiveByCaliber.get(caliber) ?? 0,
    }));

  const firearmCounts: FirearmCount[] = firearms
    .map((f) => ({
      id: f.id,
      name: f.name,
      count: countByFirearmId.get(f.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { totalMagazines: magazines.length, byCaliber, firearmCounts };
}

/** Load the requester's viewer-relative visible inventory and summarize it. */
export async function inventorySummary(actorId: string): Promise<Summary> {
  const [firearms, magazines] = await Promise.all([
    listFirearms(actorId),
    listMagazines(actorId),
  ]);
  return computeSummary(firearms, magazines);
}
