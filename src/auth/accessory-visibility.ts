import { eq, inArray } from "drizzle-orm";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import type { DbOrTx } from "@/src/db/client";
import { accessory, firearm } from "@/src/db/schema";
import { authorizeUpdate } from "./authorize";
import { NotAuthorizedError, NotFoundError } from "./errors";
import {
  getVisibleIds,
  type Permission,
  resolveGrantPermission,
  resolvePermission,
} from "./visibility";

/**
 * Accessory visibility & mount authorization.
 *
 * An accessory is reachable by THREE paths, and this file is the single seam
 * where they are combined so they cannot drift between callers:
 *
 *   owned  ∪  directly granted  ∪  mounted on a firearm the requester can see
 *
 * The middle path is new in #23, which reversed #8's decision that accessories
 * carry no grants of their own. The reversal is additive: the inherited path
 * (#8's original behavior) is RETAINED, not replaced, so nobody who can see a
 * mounted accessory today loses that access — see AE3 in
 * `__tests__/accessory-sharing.test.ts`.
 *
 * Where paths disagree the requester holds the STRONGEST permission any of
 * them grants, and ownership always wins (#23 R9).
 *
 * The direct-grant half lives in the generic `visibility.ts`
 * (`getVisibleIds(..., "accessory")`); the mount-inheritance half lives here,
 * because only the inventory layer should know what `current_firearm_id`
 * means. Pushing that into the shared auth layer would make one parent type
 * special (#23 KTD6).
 */

/** Rank permissions so "strongest path wins" is a comparison, not a chain of ifs. */
const PERMISSION_RANK: Record<Permission, number> = {
  view: 1,
  edit: 2,
  owner: 3,
};

/** The stronger of two permissions; `null` means "no access via that path". */
function strongest(
  a: Permission | null,
  b: Permission | null,
): Permission | null {
  if (a === null) return b;
  if (b === null) return a;
  return PERMISSION_RANK[a] >= PERMISSION_RANK[b] ? a : b;
}

/**
 * Every accessory id visible to `userId` — the union of all three paths
 * (owned, directly granted, mounted on a visible firearm).
 */
export async function listVisibleAccessoryIds(
  db: DbOrTx,
  userId: string,
  precomputedVisibleFirearmIds?: Set<string>,
): Promise<Set<string>> {
  // The two lookups are independent — the accessory's own grants and the
  // firearm set the inherited path needs — so they are issued together. Real
  // overlap only happens on the pool; a transaction-bound `tx` serializes them
  // on its single session either way.
  const [ids, visibleFirearmIds] = await Promise.all([
    // Owned ∪ directly granted (#23 R7) — the generic grant machinery.
    getVisibleIds(db, userId, "accessory"),
    // The caller may already hold this (see `listAccessories`), in which case
    // re-deriving it is a wasted query.
    precomputedVisibleFirearmIds ?? getVisibleIds(db, userId, "firearm"),
  ]);

  // ∪ mounted on a firearm the requester can see (#8's path, retained by R8).
  if (visibleFirearmIds.size > 0) {
    const mountedOnVisible = await db
      .select({ id: accessory.id })
      .from(accessory)
      .where(inArray(accessory.currentFirearmId, [...visibleFirearmIds]));
    for (const row of mountedOnVisible) ids.add(row.id);
  }

  return ids;
}

/**
 * Resolve the requester's effective permission on one accessory, or null when
 * it is outside their visible set entirely.
 *
 * Ownership short-circuits (nothing outranks it). Otherwise the direct grant
 * and the mounted-firearm inheritance are BOTH evaluated and the stronger
 * wins (#23 R9) — a view grant on the accessory plus edit on the firearm it
 * is mounted to yields edit, and neither path can quietly downgrade the other.
 */
export async function resolveAccessoryPermission(
  db: DbOrTx,
  userId: string,
  accessoryId: string,
): Promise<Permission | null> {
  const rows = await db
    .select({
      ownerId: accessory.ownerId,
      currentFirearmId: accessory.currentFirearmId,
    })
    .from(accessory)
    .where(eq(accessory.id, accessoryId))
    .limit(1);
  if (rows.length === 0) return null;

  const row = rows[0];
  if (row.ownerId === userId) return "owner";

  // Both paths are independent reads and both must be evaluated anyway (the
  // stronger wins), so they are issued together rather than awaited in
  // sequence. This genuinely overlaps only when `db` is the pool; on a
  // transaction-bound `tx` a single Postgres session executes them one after
  // another regardless, so treat it as "no worse, sometimes better", not as a
  // guaranteed halving.
  //
  // The direct leg uses the grant-only lookup because the ownership check
  // above has already ruled ownership out — `resolvePermission` would re-run
  // an owned-row query that cannot match, on every non-owner access.
  //
  // The inherited leg deliberately keeps the FULL resolution: the requester
  // may genuinely own the host firearm, and that must resolve to `owner`.
  const [direct, inherited] = await Promise.all([
    resolveGrantPermission(db, userId, "accessory", accessoryId),
    row.currentFirearmId
      ? resolvePermission(db, userId, "firearm", row.currentFirearmId)
      : Promise.resolve(null),
  ]);

  return strongest(direct, inherited);
}

/**
 * Require owner/edit on an accessory, or throw.
 *
 * The three-way outcome matters and is why this is one shared helper rather
 * than an inline check per call site: a `view` holder is visible-but-forbidden
 * (403), while anything outside the visible set is indistinguishable from
 * absent (404) so the response cannot be used to probe for accessories the
 * requester should not know exist.
 *
 * Also the single place `assertWritesAllowed` is enforced for accessory
 * writes, so a new mutating path cannot forget the maintenance-mode gate.
 */
export async function requireAccessoryEdit(
  tx: DbOrTx,
  actorId: string,
  accessoryId: string,
): Promise<Permission> {
  await assertWritesAllowed(tx);

  const permission = await resolveAccessoryPermission(tx, actorId, accessoryId);
  if (permission === "owner" || permission === "edit") return permission;
  if (permission === "view") {
    throw new NotAuthorizedError(
      "read-only access; cannot modify this accessory",
    );
  }
  throw new NotFoundError();
}

/**
 * Require permission to DELETE an accessory.
 *
 * Deliberately narrower than {@link requireAccessoryEdit}: an `edit` grant made
 * directly on the accessory (#23) permits modification but NOT deletion.
 *
 * Two rules are in tension and this reconciles them:
 *
 * - Every other grantable parent type (firearm, magazine, ammo) routes delete
 *   through `authorizeDelete` -> `authorizeOwnerOnly`. Sharing something at
 *   `edit` has never conferred the right to destroy it.
 * - #8 nonetheless shipped delete-by-firearm-edit-grantee for accessories, on
 *   the reasoning that whoever may edit the host gun may strip parts off it.
 *   Removing that now would regress shipped behavior.
 *
 * So the INHERITED path keeps its delete power exactly as #8 shipped it, and
 * the newly-added direct-grant path follows the repo-wide owner-only rule.
 * A direct editor who also inherits edit from the host firearm still passes —
 * they qualify through the inherited path, not the direct one.
 */
export async function requireAccessoryDelete(
  tx: DbOrTx,
  actorId: string,
  accessoryId: string,
): Promise<void> {
  await assertWritesAllowed(tx);

  const rows = await tx
    .select({
      ownerId: accessory.ownerId,
      currentFirearmId: accessory.currentFirearmId,
    })
    .from(accessory)
    .where(eq(accessory.id, accessoryId))
    .limit(1);
  if (rows.length === 0) throw new NotFoundError();

  const row = rows[0];
  if (row.ownerId === actorId) return;

  const inherited = row.currentFirearmId
    ? await resolvePermission(tx, actorId, "firearm", row.currentFirearmId)
    : null;
  if (inherited === "owner" || inherited === "edit") return;

  // Reachable but not deletable -> 403; entirely invisible -> 404, so the
  // response can never be used to probe for accessories that exist.
  const anyAccess = await resolveAccessoryPermission(tx, actorId, accessoryId);
  if (anyAccess !== null) {
    throw new NotAuthorizedError(
      "only the owner may delete this accessory; an edit grant permits changes, not deletion",
    );
  }
  throw new NotFoundError();
}

/**
 * Require any level of access to an accessory (owner/edit/view), returning it.
 * Not-found for anything outside the visible set — same non-probing rule as
 * {@link requireAccessoryEdit}.
 */
export async function requireAccessoryView(
  db: DbOrTx,
  actorId: string,
  accessoryId: string,
): Promise<Permission> {
  const permission = await resolveAccessoryPermission(db, actorId, accessoryId);
  if (permission === null) throw new NotFoundError();
  return permission;
}

/**
 * Authorize mounting/reassigning/unmounting an accessory.
 *
 * Three checks, and each guards a different firearm:
 *
 * 1. The actor must be able to edit the ACCESSORY itself.
 * 2. When the accessory is currently mounted, the actor must also be able to
 *    update the firearm it is being detached FROM — unmounting or reassigning
 *    away changes that firearm's loadout, so it is a write to that firearm too.
 * 3. When mounting ONTO a firearm, the actor must be able to update the target
 *    AND the target must be owned by the accessory's owner — an accessory may
 *    only be mounted on a firearm owned by its own owner, which prevents
 *    cross-tenant relocation even when the actor holds edit grants on both.
 *
 * Check 2 became load-bearing in #23. Before accessories were independently
 * grantable, the ONLY way to hold `edit` on one was to inherit it from the
 * firearm it was mounted to, so passing check 1 implied passing check 2 and
 * the detach side needed no explicit guard. A direct accessory grant breaks
 * that implication: without check 2, an accessory-only edit-grantee with no
 * access whatsoever to the host firearm could detach the accessory from it.
 *
 * It is not a regression for anyone who could already do this: an accessory's
 * owner also owns its host (guaranteed by check 3's cross-tenant rule), and a
 * firearm edit-grantee passes check 2 by definition.
 */
export async function authorizeMount(
  tx: DbOrTx,
  actorId: string,
  accessoryId: string,
  targetFirearmId: string | null,
): Promise<void> {
  // Same gate as every other accessory write — including the maintenance-mode
  // check, which `requireAccessoryEdit` owns.
  await requireAccessoryEdit(tx, actorId, accessoryId);

  const [current] = await tx
    .select({ currentFirearmId: accessory.currentFirearmId })
    .from(accessory)
    .where(eq(accessory.id, accessoryId))
    .limit(1);
  if (!current) throw new NotFoundError();

  // Detaching from the current host is a write to that host's loadout (#23).
  if (
    current.currentFirearmId &&
    current.currentFirearmId !== targetFirearmId
  ) {
    await authorizeUpdate(tx, actorId, "firearm", current.currentFirearmId);
  }

  if (targetFirearmId === null) return;

  await authorizeUpdate(tx, actorId, "firearm", targetFirearmId);

  const accessoryRows = await tx
    .select({ ownerId: accessory.ownerId })
    .from(accessory)
    .where(eq(accessory.id, accessoryId))
    .limit(1);
  if (accessoryRows.length === 0) throw new NotFoundError();
  const accessoryOwnerId = accessoryRows[0].ownerId;

  const firearmRows = await tx
    .select({ ownerId: firearm.ownerId })
    .from(firearm)
    .where(eq(firearm.id, targetFirearmId))
    .limit(1);
  if (firearmRows.length === 0) throw new NotFoundError();
  const targetFirearmOwnerId = firearmRows[0].ownerId;

  if (targetFirearmOwnerId !== accessoryOwnerId) {
    throw new NotAuthorizedError(
      "an accessory may only be mounted on a firearm owned by its owner",
    );
  }
}
