import { and, eq } from "drizzle-orm";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import { type DbOrTx, db as defaultDb } from "@/src/db/client";
import { grant } from "@/src/db/schema";
import { NotAuthorizedError, NotFoundError } from "./errors";
import { type ParentType, parentTable, resolvePermission } from "./visibility";

/**
 * The single write-authorization gate (U4, KTD-3/KTD-5, R66/R70). Every
 * mutation routes through one of these so owner-only delete and create-on-behalf
 * are enforced in one place. Framework-agnostic (no Next.js imports).
 */

/**
 * Resolve the owner for a create/bulk-create. Defaults to the actor; a different
 * target owner A is authorized iff the actor holds an active edit grant from A
 * with `allow_create_on_behalf` set (KTD-5). Must be called inside the same
 * transaction as the insert so a concurrent revoke cannot race the create.
 */
export async function resolveCreateOwner(
  tx: DbOrTx,
  actorId: string,
  targetOwnerId?: string | null,
): Promise<string> {
  await assertWritesAllowed(tx);

  if (!targetOwnerId || targetOwnerId === actorId) return actorId;

  const rows = await tx
    .select({ id: grant.id })
    .from(grant)
    .where(
      and(
        eq(grant.ownerId, targetOwnerId),
        eq(grant.granteeId, actorId),
        eq(grant.permission, "edit"),
        eq(grant.allowCreateOnBehalf, true),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new NotAuthorizedError(
      "not authorized to create records owned by this user",
    );
  }
  return targetOwnerId;
}

/**
 * Authorize an update. Owner or edit-grantee may modify (R14). A view-grantee is
 * forbidden (visible but read-only). An item outside the visible set is reported
 * not-found so existence is never revealed (R70).
 */
export async function authorizeUpdate(
  tx: DbOrTx,
  actorId: string,
  parentType: ParentType,
  parentId: string,
): Promise<void> {
  await assertWritesAllowed(tx);

  const perm = await resolvePermission(tx, actorId, parentType, parentId);
  if (perm === "owner" || perm === "edit") return;
  if (perm === "view") {
    throw new NotAuthorizedError("read-only access; cannot modify this item");
  }
  throw new NotFoundError();
}

/**
 * Shared owner-only gate. Owner passes; a visible non-owner is forbidden (the
 * message names the attempted `action`); an unseen item is not-found so
 * existence is never revealed (R70). Backing both owner-only callers keeps the
 * owner/edit/view/not-found precedence in one place so it can't drift.
 */
async function authorizeOwnerOnly(
  tx: DbOrTx,
  actorId: string,
  parentType: ParentType,
  parentId: string,
  action: string,
): Promise<void> {
  const perm = await resolvePermission(tx, actorId, parentType, parentId);
  if (perm === "owner") return;
  if (perm === "edit" || perm === "view") {
    throw new NotAuthorizedError(`only the owner may ${action} this item`);
  }
  throw new NotFoundError();
}

/**
 * Authorize an owner-only update. Used where edit-grantees must NOT modify —
 * magazine actions are owner-only per the read-only-detail-view scope (R13).
 */
export async function authorizeOwnerOnlyUpdate(
  tx: DbOrTx,
  actorId: string,
  parentType: ParentType,
  parentId: string,
): Promise<void> {
  await assertWritesAllowed(tx);
  return authorizeOwnerOnly(tx, actorId, parentType, parentId, "modify");
}

/**
 * Authorize a delete. Owner-only (KTD-3) — an edit grant permits modify, not
 * delete. A visible non-owner is forbidden; an unseen item is not-found (R70).
 */
export async function authorizeDelete(
  tx: DbOrTx,
  actorId: string,
  parentType: ParentType,
  parentId: string,
): Promise<void> {
  await assertWritesAllowed(tx);
  return authorizeOwnerOnly(tx, actorId, parentType, parentId, "delete");
}

/**
 * Authorize an owner-only READ (U4, KTD1, R8/R9). Firearm documents are
 * owner-only on every operation — unlike photos, a view- or edit-grantee may
 * NOT list, view, or download them — so reads need the same owner-only gate the
 * mutations already use. Owner passes; a visible non-owner is forbidden; an
 * unseen item is not-found so existence is never revealed (R9). No read-only
 * owner gate existed before documents; this is the read wrapper alongside
 * `authorizeOwnerOnlyUpdate` and `authorizeDelete`.
 */
export async function authorizeOwnerOnlyRead(
  tx: DbOrTx,
  actorId: string,
  parentType: ParentType,
  parentId: string,
): Promise<void> {
  return authorizeOwnerOnly(tx, actorId, parentType, parentId, "view");
}

/**
 * Optional pre-delete callback (U5, KTD8). Invoked inside the same
 * transaction as the delete, after authorization and before the row delete,
 * receiving the transaction and the parent id. Used to clean up
 * parent-owned side effects (e.g. stored blobs) that the DB's cascading FK
 * can't reach. Opt-in per call site — magazine/ammo delete pass none and are
 * unaffected.
 */
export type PreDeleteHook = (tx: DbOrTx, id: string) => Promise<void>;

/**
 * Owner-only delete of an owned parent, cascading children and grants in one
 * transaction (KTD-3, R17b). Join rows cascade via FK; grants are removed by the
 * BEFORE DELETE trigger within the same transaction (and would be redundant to
 * delete again here). `onBeforeDelete`, when supplied, runs after authorization
 * and before the row delete (KTD8) — currently wired only for firearm delete.
 * Returns nothing; throws NotFound/NotAuthorized.
 */
export async function authorizeAndDeleteParent(
  actorId: string,
  parentType: ParentType,
  parentId: string,
  database: DbOrTx = defaultDb,
  onBeforeDelete?: PreDeleteHook,
): Promise<void> {
  await assertWritesAllowed(database);

  const runner = "transaction" in database ? database : null;
  const run = async (tx: DbOrTx) => {
    await authorizeDelete(tx, actorId, parentType, parentId);
    if (onBeforeDelete) {
      await onBeforeDelete(tx, parentId);
    }
    const table = parentTable(parentType);
    const deleted = await tx
      .delete(table)
      .where(eq(table.id, parentId))
      .returning({ id: table.id });
    if (deleted.length === 0) throw new NotFoundError();
  };
  if (runner) {
    await runner.transaction(run);
  } else {
    await run(database);
  }
}
