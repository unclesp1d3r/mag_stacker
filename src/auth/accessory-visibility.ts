import { eq, inArray } from "drizzle-orm";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import type { DbOrTx } from "@/src/db/client";
import { accessory, firearm } from "@/src/db/schema";
import { authorizeUpdate } from "./authorize";
import { NotAuthorizedError, NotFoundError } from "./errors";
import {
  getVisibleIds,
  type Permission,
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
): Promise<Set<string>> {
  // Owned ∪ directly granted (#23 R7) — the generic grant machinery.
  const ids = await getVisibleIds(db, userId, "accessory");

  // ∪ mounted on a firearm the requester can see (#8's path, retained by R8).
  const visibleFirearmIds = await getVisibleIds(db, userId, "firearm");
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

  const direct = await resolvePermission(db, userId, "accessory", accessoryId);
  const inherited = row.currentFirearmId
    ? await resolvePermission(db, userId, "firearm", row.currentFirearmId)
    : null;

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
 * Authorize mounting/reassigning/unmounting an accessory. The actor must be
 * able to edit the accessory itself (owner or edit-grantee via its current
 * mount, if any). When mounting onto a firearm (`targetFirearmId` non-null),
 * the actor must also be able to update that firearm AND the firearm must be
 * owned by the same user as the accessory — an accessory may only be mounted
 * on a firearm owned by its own owner, which prevents cross-tenant relocation
 * even when the actor happens to hold edit grants on both sides.
 */
export async function authorizeMount(
  tx: DbOrTx,
  actorId: string,
  accessoryId: string,
  targetFirearmId: string | null,
): Promise<void> {
  await assertWritesAllowed(tx);

  const perm = await resolveAccessoryPermission(tx, actorId, accessoryId);
  if (perm !== "owner" && perm !== "edit") {
    if (perm === "view") {
      throw new NotAuthorizedError(
        "read-only access; cannot modify this accessory",
      );
    }
    throw new NotFoundError();
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
