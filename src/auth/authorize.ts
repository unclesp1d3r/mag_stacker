import { and, eq } from "drizzle-orm";
import { type DbOrTx, db as defaultDb } from "@/src/db/client";
import { firearm, grant, magazine } from "@/src/db/schema";
import { NotAuthorizedError, NotFoundError } from "./errors";
import { type ParentType, resolvePermission } from "./visibility";

/**
 * The single write-authorization gate (U4, KTD-3/KTD-5, R66/R70). Every
 * mutation routes through one of these so owner-only delete and create-on-behalf
 * are enforced in one place. Framework-agnostic (no Next.js imports).
 */

function parentTable(parentType: ParentType) {
  return parentType === "firearm" ? firearm : magazine;
}

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
  const perm = await resolvePermission(tx, actorId, parentType, parentId);
  if (perm === "owner" || perm === "edit") return;
  if (perm === "view") {
    throw new NotAuthorizedError("read-only access; cannot modify this item");
  }
  throw new NotFoundError();
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
  const perm = await resolvePermission(tx, actorId, parentType, parentId);
  if (perm === "owner") return;
  if (perm === "edit" || perm === "view") {
    throw new NotAuthorizedError("only the owner may delete this item");
  }
  throw new NotFoundError();
}

/**
 * Owner-only delete of an owned parent, cascading children and grants in one
 * transaction (KTD-3, R17b). Join rows cascade via FK; grants are removed by the
 * BEFORE DELETE trigger within the same transaction (and would be redundant to
 * delete again here). Returns nothing; throws NotFound/NotAuthorized.
 */
export async function authorizeAndDeleteParent(
  actorId: string,
  parentType: ParentType,
  parentId: string,
  database: DbOrTx = defaultDb,
): Promise<void> {
  const runner = "transaction" in database ? database : null;
  const run = async (tx: DbOrTx) => {
    await authorizeDelete(tx, actorId, parentType, parentId);
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
