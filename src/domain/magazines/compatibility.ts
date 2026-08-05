import type { DbOrTx } from "@/src/db/client";
import { magazineFirearm } from "@/src/db/schema";
import {
  type CompatibilityRelation,
  loadCompatibility as loadRelation,
  loadCompatibilityBatch as loadRelationBatch,
  replaceCompatibility as replaceRelation,
} from "../compatibility/relation";

/**
 * Magazine compatibility-set management (U6, KTD-8).
 *
 * The ordinal/dedup/rollback/viewer-relative rules live in
 * `../compatibility/relation.ts`, shared with accessory compatibility (#23
 * KTD3) so the two relations cannot drift — see that file for why the
 * visibility gate in particular is shared rather than duplicated. This module
 * is the magazine binding plus the public API magazine callers already use.
 */

const MAGAZINE_FIREARM: CompatibilityRelation = {
  table: magazineFirearm,
  parentIdColumn: magazineFirearm.magazineId,
  firearmIdColumn: magazineFirearm.firearmId,
  ordinalColumn: magazineFirearm.ordinal,
  buildRow: (magazineId, firearmId, ordinal) => ({
    magazineId,
    firearmId,
    ordinal,
  }),
};

export { dedupeFirearmIds } from "../compatibility/relation";

/**
 * Atomically replace a magazine's compatibility set (R31/R33). Requires every
 * firearm to be visible to the acting user (R37 — cross-owner shared firearms
 * are allowed, KTD-4); an unknown or unseeable firearm throws, rolling back
 * the surrounding transaction (R32). Must run inside a tx.
 */
export async function replaceCompatibility(
  tx: DbOrTx,
  actorId: string,
  magazineId: string,
  firearmIds: string[],
): Promise<string[]> {
  return replaceRelation(tx, MAGAZINE_FIREARM, actorId, magazineId, firearmIds);
}

/**
 * Load a single magazine's compatible firearm ids in ordinal order, dropping
 * any outside the requester's visible firearm set (viewer-relative, R17a).
 */
export async function loadCompatibility(
  db: DbOrTx,
  actorId: string,
  magazineId: string,
): Promise<string[]> {
  return loadRelation(db, MAGAZINE_FIREARM, actorId, magazineId);
}

/**
 * Batched viewer-relative compatibility for many magazines at once (KTD-1 — no
 * N+1 at scale). Returns a Map of magazineId → ordered visible firearm ids.
 */
export async function loadCompatibilityBatch(
  db: DbOrTx,
  visibleFirearmIds: Set<string>,
  magazineIds: string[],
): Promise<Map<string, string[]>> {
  return loadRelationBatch(
    db,
    MAGAZINE_FIREARM,
    visibleFirearmIds,
    magazineIds,
  );
}
