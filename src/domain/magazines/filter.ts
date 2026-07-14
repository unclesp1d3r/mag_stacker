import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { getVisibleIds } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { magazine, magazineFirearm } from "@/src/db/schema";
import { loadLastInventoriedBatch } from "@/src/domain/inventory-log/last-inventoried";
import { loadCompatibilityBatch } from "./compatibility";
import type { MagazineWithCompatibility } from "./service";

/** A filtered-list row with last-inventoried date attached (U2, #70). */
export type MagazineListRow = MagazineWithCompatibility & {
  lastInventoriedAt: Date | null;
};

/**
 * Magazine search/filter (U9, parity §8). Three optional, AND-combined filters
 * over the requester's visible magazines. A zero filter returns the full visible
 * list ordered by brand/model (R49). There is no firearm-list search (R51).
 */
export interface MagazineFilter {
  /** Case-insensitive substring; LIKE metacharacters matched literally (R50). */
  brandModel?: string;
  /** Exact match, case-sensitive (R49). */
  caliber?: string;
  /** Magazines linked to this firearm id (R49). */
  compatibleFirearmId?: string;
}

/** Escape LIKE metacharacters so they match literally under `ESCAPE '\'` (R50). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listMagazinesFiltered(
  actorId: string,
  filter: MagazineFilter,
): Promise<MagazineListRow[]> {
  const visibleMagazines = await getVisibleIds(db, actorId, "magazine");
  if (visibleMagazines.size === 0) return [];

  const conditions: SQL[] = [inArray(magazine.id, [...visibleMagazines])];

  if (filter.brandModel && filter.brandModel.trim() !== "") {
    const pattern = `%${escapeLike(filter.brandModel)}%`;
    conditions.push(sql`${magazine.brandModel} ILIKE ${pattern} ESCAPE '\\'`);
  }
  if (filter.caliber && filter.caliber !== "") {
    conditions.push(eq(magazine.caliber, filter.caliber));
  }
  if (filter.compatibleFirearmId) {
    const linked = db
      .select({ id: magazineFirearm.magazineId })
      .from(magazineFirearm)
      .where(eq(magazineFirearm.firearmId, filter.compatibleFirearmId));
    conditions.push(inArray(magazine.id, linked));
  }

  const rows = await db
    .select()
    .from(magazine)
    .where(and(...conditions))
    .orderBy(asc(magazine.brandModel));

  const magazineIds = rows.map((r) => r.id);
  const visibleFirearms = await getVisibleIds(db, actorId, "firearm");
  // R8 enforcement point: `rows` is already visibility-scoped to `actorId`
  // (constrained to `visibleMagazines` above), so passing its ids straight
  // into the loaders — which trust their input and do no visibility check
  // of their own — is safe here. The two batch loads are independent, so
  // run them concurrently on the shared pool.
  const [byMag, byLastInventoried] = await Promise.all([
    loadCompatibilityBatch(db, visibleFirearms, magazineIds),
    loadLastInventoriedBatch(db, "magazine", magazineIds),
  ]);
  return rows.map((r) => ({
    ...r,
    compatibleFirearmIds: byMag.get(r.id) ?? [],
    lastInventoriedAt: byLastInventoried.get(r.id) ?? null,
  }));
}
