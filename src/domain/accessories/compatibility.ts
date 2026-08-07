import type { DbOrTx } from "@/src/db/client";
import { accessoryFirearm } from "@/src/db/schema";
import {
  type CompatibilityRelation,
  loadCompatibility as loadRelation,
  loadCompatibilityBatch as loadRelationBatch,
  replaceCompatibility as replaceRelation,
} from "../compatibility/relation";

/**
 * Accessory compatibility-set management (#23 U2, R4/R5/R6/R19).
 *
 * "Which firearms does this accessory FIT" — a capability claim, many-to-many,
 * ordered. This is NOT the accessory's current mount: `current_firearm_id`
 * records what it is attached to right now (single, nullable), and the two are
 * deliberately independent (R6). Nothing in this module reads or writes the
 * mount, and `mountAccessory` does not touch these rows.
 *
 * The ordinal/dedup/rollback/viewer-relative rules — including the gate that
 * refuses a firearm the actor cannot see — live in
 * `../compatibility/relation.ts`, shared with magazine compatibility (KTD3) so
 * the two relations cannot drift.
 */

const ACCESSORY_FIREARM: CompatibilityRelation<typeof accessoryFirearm> = {
  table: accessoryFirearm,
  parentIdColumn: accessoryFirearm.accessoryId,
  firearmIdColumn: accessoryFirearm.firearmId,
  ordinalColumn: accessoryFirearm.ordinal,
  buildRow: (accessoryId, firearmId, ordinal) => ({
    accessoryId,
    firearmId,
    ordinal,
  }),
};

/**
 * Atomically replace an accessory's compatible-firearm set. Every firearm must
 * be visible to the acting user; an unknown or unseeable one throws, rolling
 * back the surrounding transaction. Must run inside a tx.
 */
export async function replaceAccessoryCompatibility(
  tx: DbOrTx,
  actorId: string,
  accessoryId: string,
  firearmIds: string[],
): Promise<string[]> {
  return replaceRelation(
    tx,
    ACCESSORY_FIREARM,
    actorId,
    accessoryId,
    firearmIds,
  );
}

/**
 * One accessory's compatible firearm ids in ordinal order, dropping any
 * outside the requester's visible firearm set (viewer-relative).
 */
export async function loadAccessoryCompatibility(
  db: DbOrTx,
  actorId: string,
  accessoryId: string,
): Promise<string[]> {
  return loadRelation(db, ACCESSORY_FIREARM, actorId, accessoryId);
}

/**
 * Batched viewer-relative compatibility for many accessories at once (no N+1
 * on the list view). Returns a Map of accessoryId → ordered visible firearm ids.
 */
export async function loadAccessoryCompatibilityBatch(
  db: DbOrTx,
  visibleFirearmIds: Set<string>,
  accessoryIds: string[],
): Promise<Map<string, string[]>> {
  return loadRelationBatch(
    db,
    ACCESSORY_FIREARM,
    visibleFirearmIds,
    accessoryIds,
  );
}
