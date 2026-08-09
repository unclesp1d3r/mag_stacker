import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/src/db/client";
import { firearm, magazineFirearm } from "@/src/db/schema";
import {
  type CompatibilityRelation,
  loadCompatibility as loadRelation,
  loadCompatibilityBatch as loadRelationBatch,
  replaceCompatibility as replaceRelation,
} from "../compatibility/relation";
import { ValidationError } from "../errors";

/**
 * Magazine compatibility-set management (U6, KTD-8).
 *
 * The ordinal/dedup/rollback/viewer-relative rules live in
 * `../compatibility/relation.ts`, shared with accessory compatibility (#23
 * KTD3) so the two relations cannot drift — see that file for why the
 * visibility gate in particular is shared rather than duplicated. This module
 * is the magazine binding plus the public API magazine callers already use.
 */

const MAGAZINE_FIREARM: CompatibilityRelation<typeof magazineFirearm> = {
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
 * Atomically replace the part of a magazine's compatibility set that the actor
 * can see (R31/R33); links to firearms outside their visible set survive
 * untouched. Requires every submitted firearm to be visible to the acting user
 * (R37 — cross-owner shared firearms are allowed, KTD-4); an unknown or
 * unseeable firearm throws, rolling back the surrounding transaction (R32).
 * Must run inside a tx.
 */
export async function replaceCompatibility(
  tx: DbOrTx,
  actorId: string,
  magazineId: string,
  firearmIds: string[],
): Promise<string[]> {
  await assertAllMagazineFed(tx, firearmIds);
  return replaceRelation(tx, MAGAZINE_FIREARM, actorId, magazineId, firearmIds);
}

/**
 * Reject any submitted firearm that takes no detachable magazines (#37 R5).
 *
 * This is the write-side half of the invariant whose read-side half lives in
 * `updateFirearm`'s `assertNoCompatibleMagazines`. That guard blocks the
 * firearm→non-magazine-fed transition while links exist; this one blocks
 * creating a link to a firearm that is *already* non-magazine-fed. Without
 * both, the invariant holds only in one direction: filtering the picker in
 * `app/(app)/magazines/firearm-options.ts` is presentation only, so a stale
 * form tab (options rendered before the firearm was flagged) or any non-UI
 * caller could still write the row the whole feature assumes cannot exist.
 *
 * It lives HERE, in the magazine binding, and deliberately not in the shared
 * `../compatibility/relation.ts`: accessory compatibility uses that same core,
 * and an optic or light mounting on a revolver is entirely legitimate. Pushing
 * this rule down into the shared relation would silently forbid that.
 *
 * Like `assertNoCompatibleMagazines`, the lookup is NOT visibility-scoped —
 * whether a firearm is magazine-fed is a property of the firearm, not of who
 * is looking at it. The caller has already been visibility-gated by
 * `replaceRelation`, so this adds no disclosure: it can only reject an id the
 * actor was able to name anyway.
 */
async function assertAllMagazineFed(
  tx: DbOrTx,
  firearmIds: string[],
): Promise<void> {
  if (firearmIds.length === 0) return;
  // `FOR UPDATE` is what makes this safe against a concurrent flag flip, not
  // just a nicety. Without the lock, this read and the one in
  // `assertNoCompatibleMagazines` are a classic time-of-check/time-of-use pair:
  // under READ COMMITTED, a transaction marking the firearm non-magazine-fed
  // and a transaction linking a magazine to it can each pass their own check
  // against a snapshot the other is about to invalidate, and both commit —
  // producing exactly the state neither guard permits on its own.
  //
  // Both guards take this same firearm-row lock BEFORE their dependent read, so
  // they serialize: the loser blocks, then re-reads the winner's committed row
  // and rejects. Ordering by id keeps multi-firearm submissions from deadlocking
  // against each other by acquiring locks in a consistent order.
  const submitted = await tx
    .select({ id: firearm.id, isMagazineFed: firearm.isMagazineFed })
    .from(firearm)
    .where(inArray(firearm.id, firearmIds))
    .orderBy(firearm.id)
    .for("update");
  if (submitted.some((row) => !row.isMagazineFed)) {
    throw new ValidationError(["compatibleFirearmNotMagazineFed"]);
  }
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
