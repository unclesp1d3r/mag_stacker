import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/src/db/client";
import { firearm, grant, magazine } from "@/src/db/schema";

/**
 * Visibility computation (U4, KTD-1). The single source of truth for "what can
 * this user see?" — the visible set is owned IDs ∪ view/edit-granted IDs,
 * resolved via indexed lookups (R9, R72).
 *
 * No Next.js imports — framework-agnostic (KTD-2). Per-request memoization is
 * applied at the delivery edge (server components / actions), not here.
 */

export type ParentType = "firearm" | "magazine";

/** Item-level permission the requester holds. `owner` is full control. */
export type Permission = "owner" | "edit" | "view";

function parentTable(parentType: ParentType) {
  return parentType === "firearm" ? firearm : magazine;
}

/**
 * The set of parent IDs of `parentType` visible to `userId`: owned ∪ granted.
 */
export async function getVisibleIds(
  db: DbOrTx,
  userId: string,
  parentType: ParentType,
): Promise<Set<string>> {
  const table = parentTable(parentType);
  const owned = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.ownerId, userId));
  const granted = await db
    .select({ id: grant.parentId })
    .from(grant)
    .where(and(eq(grant.granteeId, userId), eq(grant.parentType, parentType)));
  const ids = new Set<string>();
  for (const row of owned) ids.add(row.id);
  for (const row of granted) ids.add(row.id);
  return ids;
}

/**
 * Resolve the requester's permission on a specific item, or null if it is
 * outside their visible set. Ownership wins over any grant (own ⇒ full).
 */
export async function resolvePermission(
  db: DbOrTx,
  userId: string,
  parentType: ParentType,
  parentId: string,
): Promise<Permission | null> {
  const table = parentTable(parentType);
  const owned = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, parentId), eq(table.ownerId, userId)))
    .limit(1);
  if (owned.length > 0) return "owner";

  const granted = await db
    .select({ permission: grant.permission })
    .from(grant)
    .where(
      and(
        eq(grant.granteeId, userId),
        eq(grant.parentType, parentType),
        eq(grant.parentId, parentId),
      ),
    )
    .limit(1);
  if (granted.length > 0) {
    return granted[0].permission === "edit" ? "edit" : "view";
  }
  return null;
}

/** True when the item is visible to the requester (owned or granted). */
export async function isVisible(
  db: DbOrTx,
  userId: string,
  parentType: ParentType,
  parentId: string,
): Promise<boolean> {
  return (await resolvePermission(db, userId, parentType, parentId)) !== null;
}
