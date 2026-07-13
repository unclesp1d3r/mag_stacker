import { and, eq } from "drizzle-orm";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import type { DbOrTx } from "@/src/db/client";
import { grant } from "@/src/db/schema";
import { NotAuthorizedError } from "./errors";
import {
  type ParentType,
  type Permission,
  resolvePermission,
} from "./visibility";

/**
 * Grant management (U4). Only an item's owner may share or revoke it (R12, R15,
 * KTD-3 — edit-grantees do not re-share). The create-on-behalf flag is only
 * meaningful on edit grants (KTD-5).
 */

export type GrantPermission = Exclude<Permission, "owner">; // "view" | "edit"

export interface ActiveGrant {
  granteeId: string;
  permission: GrantPermission;
  allowCreateOnBehalf: boolean;
}

export interface CreateGrantInput {
  actorId: string;
  granteeId: string;
  parentType: ParentType;
  parentId: string;
  permission: GrantPermission;
  allowCreateOnBehalf?: boolean;
}

/**
 * Share an owned item with another user at view or edit. Owner-only. Re-granting
 * the same (grantee, item) updates the existing grant (one grant per grantee per
 * item). `allowCreateOnBehalf` is forced false for view grants.
 */
export async function createGrant(
  db: DbOrTx,
  input: CreateGrantInput,
): Promise<void> {
  await assertWritesAllowed(db);

  const { actorId, granteeId, parentType, parentId, permission } = input;
  if (granteeId === actorId) {
    throw new NotAuthorizedError("cannot grant an item to its owner");
  }
  const perm = await resolvePermission(db, actorId, parentType, parentId);
  if (perm !== "owner") {
    // Non-owners (incl. edit-grantees) cannot share, and unseen items reveal
    // nothing here either.
    throw new NotAuthorizedError("only the item owner may share it");
  }
  const allowCreateOnBehalf =
    permission === "edit" ? Boolean(input.allowCreateOnBehalf) : false;

  await db
    .insert(grant)
    .values({
      ownerId: actorId,
      granteeId,
      parentType,
      parentId,
      permission,
      allowCreateOnBehalf,
    })
    .onConflictDoUpdate({
      target: [grant.granteeId, grant.parentType, grant.parentId],
      set: { ownerId: actorId, permission, allowCreateOnBehalf },
    });
}

export interface RevokeGrantInput {
  actorId: string;
  granteeId: string;
  parentType: ParentType;
  parentId: string;
}

/** Revoke a grant. Owner-only; takes effect immediately (R15). */
export async function revokeGrant(
  db: DbOrTx,
  input: RevokeGrantInput,
): Promise<void> {
  await assertWritesAllowed(db);

  const { actorId, granteeId, parentType, parentId } = input;
  const perm = await resolvePermission(db, actorId, parentType, parentId);
  if (perm !== "owner") {
    throw new NotAuthorizedError("only the item owner may revoke a grant");
  }
  await db
    .delete(grant)
    .where(
      and(
        eq(grant.ownerId, actorId),
        eq(grant.granteeId, granteeId),
        eq(grant.parentType, parentType),
        eq(grant.parentId, parentId),
      ),
    );
}

/** List active grants on an owned item (for the owner's sharing UI). Owner-only. */
export async function listGrantsForItem(
  db: DbOrTx,
  actorId: string,
  parentType: ParentType,
  parentId: string,
): Promise<ActiveGrant[]> {
  const perm = await resolvePermission(db, actorId, parentType, parentId);
  if (perm !== "owner") {
    throw new NotAuthorizedError("only the item owner may view its grants");
  }
  const rows = await db
    .select({
      granteeId: grant.granteeId,
      permission: grant.permission,
      allowCreateOnBehalf: grant.allowCreateOnBehalf,
    })
    .from(grant)
    .where(
      and(
        eq(grant.ownerId, actorId),
        eq(grant.parentType, parentType),
        eq(grant.parentId, parentId),
      ),
    );
  return rows.map((r) => ({
    granteeId: r.granteeId,
    permission: r.permission === "edit" ? "edit" : "view",
    allowCreateOnBehalf: r.allowCreateOnBehalf,
  }));
}
