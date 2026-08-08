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
 * to an armorer.
 *
 * Widening this union is NOT self-enforcing, so do not treat a clean
 * `bun run typecheck` as proof of completeness. `parentTable` below is
 * exhaustive (its `never` check fails the build on a new arm), but plenty of
 * consumers pattern-match on the string without any compiler help — see the
 * deliberate allowlist in `app/(app)/grants/share-control.tsx`, which exists
 * precisely because a new arm would otherwise become edit-shareable by
 * default. Adding a member means auditing those by hand.
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
  switch (parentType) {
    case "firearm":
      return firearm;
    case "magazine":
      return magazine;
    case "ammo":
      return ammo;
    case "accessory":
      return accessory;
    default: {
      // Compile error the moment `ParentType` gains an arm this switch does
      // not handle. Previously an if/else chain ended in `return accessory`,
      // which would have silently routed a new parent type at the accessory
      // table — a wrong-table read with no build failure.
      const unhandled: never = parentType;
      throw new Error(`unhandled parent type: ${String(unhandled)}`);
    }
  }
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
 * The permission a DIRECT GRANT gives `userId` on one item, ignoring ownership
 * entirely — null when no grant exists.
 *
 * Split out of {@link resolvePermission} for callers that have ALREADY ruled
 * ownership out (see `resolveAccessoryPermission`). For those, the ownership
 * half of `resolvePermission` is a query guaranteed to return zero rows, paid
 * on every non-owner read and write.
 *
 * Prefer `resolvePermission` unless you can point at the check that already
 * excluded ownership — on its own this answers a narrower question and will
 * report `null` for an item the user owns outright.
 */
export async function resolveGrantPermission(
  db: DbOrTx,
  userId: string,
  parentType: ParentType,
  parentId: string,
): Promise<Permission | null> {
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
  return granted.length > 0 ? toPermission(granted[0].permission) : null;
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

  return resolveGrantPermission(db, userId, parentType, parentId);
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
