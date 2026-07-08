import { eq, inArray } from "drizzle-orm";
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
 * Accessory visibility & mount authorization (U3). Accessories are owner-scoped
 * but are deliberately NOT a grant `ParentType` (see visibility.ts) — a mounted
 * accessory's visibility/permission INHERITS from its firearm; an unmounted
 * accessory is owner-only. This file is the seam where that inheritance is
 * computed, so it can't drift between callers.
 */

/**
 * The set of accessory IDs visible to `userId`: accessories they own, UNION
 * accessories currently mounted on a firearm they can see (owned or granted).
 */
export async function listVisibleAccessoryIds(
  db: DbOrTx,
  userId: string,
): Promise<Set<string>> {
  const visibleFirearmIds = await getVisibleIds(db, userId, "firearm");

  const owned = await db
    .select({ id: accessory.id })
    .from(accessory)
    .where(eq(accessory.ownerId, userId));

  const ids = new Set<string>();
  for (const row of owned) ids.add(row.id);

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
 * Resolve the requester's permission on a specific accessory, or null if it is
 * outside their visible set. Ownership wins; a mounted accessory otherwise
 * inherits the firearm's resolved permission (owner/edit/view/null). An
 * unmounted accessory the requester doesn't own is not visible (null).
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
  if (row.currentFirearmId) {
    return resolvePermission(db, userId, "firearm", row.currentFirearmId);
  }
  return null;
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
