import { asc, eq, inArray } from "drizzle-orm";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds } from "@/src/auth/visibility";
import type { DbOrTx } from "@/src/db/client";
import { magazineFirearm } from "@/src/db/schema";

/**
 * Compatibility-set management (U6, KTD-8). The ordinal/dedup/rollback rules are
 * the exact .NET extension behaviors (dotnet-extensions.md §2–§3).
 */

/**
 * De-duplicate firearm ids preserving FIRST-occurrence order (KTD-8, R34).
 * Collapsing duplicates before assigning ordinals prevents a join PK conflict
 * and keeps ordinals matching the caller-supplied sequence.
 */
export function dedupeFirearmIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Atomically replace a magazine's compatibility set (R31/R33). De-duplicates the
 * incoming list, requires every firearm to be visible to the acting user (R37 —
 * cross-owner shared firearms are allowed, KTD-4), then writes ordinals 0,1,2,….
 * An unknown or unseeable firearm throws, rolling back the surrounding
 * transaction so scalar changes do not persist (R32). Must run inside a tx.
 */
export async function replaceCompatibility(
  tx: DbOrTx,
  actorId: string,
  magazineId: string,
  firearmIds: string[],
): Promise<string[]> {
  const deduped = dedupeFirearmIds(firearmIds);

  if (deduped.length > 0) {
    const visible = await getVisibleIds(tx, actorId, "firearm");
    for (const id of deduped) {
      if (!visible.has(id)) {
        throw new NotFoundError(
          `compatible firearm ${id} is not visible to the actor`,
        );
      }
    }
  }

  await tx
    .delete(magazineFirearm)
    .where(eq(magazineFirearm.magazineId, magazineId));
  if (deduped.length > 0) {
    await tx.insert(magazineFirearm).values(
      deduped.map((firearmId, ordinal) => ({
        magazineId,
        firearmId,
        ordinal,
      })),
    );
  }
  return deduped;
}

/**
 * Load a single magazine's compatible firearm ids in ordinal order, dropping any
 * that are outside the requester's visible firearm set (viewer-relative, R17a).
 */
export async function loadCompatibility(
  db: DbOrTx,
  actorId: string,
  magazineId: string,
): Promise<string[]> {
  const visible = await getVisibleIds(db, actorId, "firearm");
  const rows = await db
    .select({ firearmId: magazineFirearm.firearmId })
    .from(magazineFirearm)
    .where(eq(magazineFirearm.magazineId, magazineId))
    .orderBy(asc(magazineFirearm.ordinal));
  return rows.map((r) => r.firearmId).filter((id) => visible.has(id));
}

/**
 * Batched viewer-relative compatibility for many magazines at once (KTD-1 — no
 * N+1 at scale). Returns a Map of magazineId → ordered visible firearm ids.
 * Pass the requester's already-computed visible firearm set to avoid re-querying.
 */
export async function loadCompatibilityBatch(
  db: DbOrTx,
  visibleFirearmIds: Set<string>,
  magazineIds: string[],
): Promise<Map<string, string[]>> {
  const byMag = new Map<string, string[]>();
  if (magazineIds.length === 0) return byMag;
  const rows = await db
    .select({
      magazineId: magazineFirearm.magazineId,
      firearmId: magazineFirearm.firearmId,
    })
    .from(magazineFirearm)
    .where(inArray(magazineFirearm.magazineId, magazineIds))
    .orderBy(asc(magazineFirearm.ordinal));
  for (const row of rows) {
    if (!visibleFirearmIds.has(row.firearmId)) continue; // viewer-relative drop (R17a)
    const list = byMag.get(row.magazineId) ?? [];
    list.push(row.firearmId);
    byMag.set(row.magazineId, list);
  }
  return byMag;
}
