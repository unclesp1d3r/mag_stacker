import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/src/db/client";
import { accessory, ammo, firearm, grant, magazine } from "@/src/db/schema";

/**
 * Visibility computation (U4, KTD-1). The single source of truth for "what can
 * this user see?" — the visible set is owned IDs ∪ view/edit-granted IDs,
 * resolved via indexed lookups (R9, R72).
 *
 * No Next.js imports — framework-agnostic (KTD-2). Per-request memoization is
 * applied at the delivery edge (server components / actions), not here.
 */

/**
 * Item families that carry their own grants.
 *
 * `accessory` joined in #23, reversing #8's "accessories are not independently
 * shareable" decision — an unmounted suppressor was invisible to everyone but
 * its owner, which is backwards for the item most likely to be lent or shown
 * to an armorer. Widening this union is deliberately the ONLY edit needed:
 * every switch that must learn about the new arm is surfaced by `tsc`, so a
 * clean `bun run typecheck` is the completeness signal (#23 KTD5).
 *
 * Note that `getVisibleIds(db, user, "accessory")` returns owned ∪
 * directly-granted only. The additional "mounted on a visible firearm" path
 * (#23 R8) lives in `accessory-visibility.ts`, not here — pushing
 * firearm-mount knowledge into the generic auth layer would make one parent
 * type special and leak inventory semantics into auth (KTD6).
 */
export type ParentType = "firearm" | "magazine" | "ammo" | "accessory";

/** Item-level permission the requester holds. `owner` is full control. */
export type Permission = "owner" | "edit" | "view";

/** Resolve a parent type to its Drizzle table — the one dispatch point the
 * auth layer shares (also consumed by `authorize.ts`). */
export function parentTable(parentType: ParentType) {
  if (parentType === "firearm") return firearm;
  if (parentType === "magazine") return magazine;
  if (parentType === "ammo") return ammo;
  return accessory;
}

/** Narrow a stored grant permission string to the item-level Permission. */
function toPermission(raw: string): Permission {
  return raw === "edit" ? "edit" : "view";
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
    return toPermission(granted[0].permission);
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

/**
 * The actor's own permission on each firearm they can see, resolved in one pass
 * (#11, KTD7): owned ⇒ `owner`, otherwise the grant's `view`/`edit`. Firearms
 * outside the visible set are absent from the map. Powers the firearms list's
 * session-control gating — the write path still enforces the real check via
 * `authorizeUpdate`.
 */
export async function visibleFirearmPermissions(
  db: DbOrTx,
  userId: string,
): Promise<Map<string, Permission>> {
  const owned = await db
    .select({ id: firearm.id })
    .from(firearm)
    .where(eq(firearm.ownerId, userId));
  const granted = await db
    .select({ id: grant.parentId, permission: grant.permission })
    .from(grant)
    .where(and(eq(grant.granteeId, userId), eq(grant.parentType, "firearm")));
  const map = new Map<string, Permission>();
  for (const row of granted) {
    map.set(row.id, toPermission(row.permission));
  }
  // Ownership wins over any grant.
  for (const row of owned) map.set(row.id, "owner");
  return map;
}
