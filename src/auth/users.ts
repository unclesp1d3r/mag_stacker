import { asc, inArray, ne } from "drizzle-orm";
import { db } from "@/src/db/client";
import { user } from "@/src/db/schema";

/**
 * Candidate grantees for the sharing UI (U16) — every account except the actor.
 * The user base is trusted (R72); this surfaces only id + display fields needed
 * to pick a share target.
 */
export interface ShareableUser {
  id: string;
  name: string;
  email: string;
}

export async function listShareableUsers(
  actorId: string,
): Promise<ShareableUser[]> {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(ne(user.id, actorId))
    .orderBy(asc(user.email));
}

/**
 * Batch id -> display-name lookup (inventory-log actor display, R9). Mirrors
 * the `emailById` map `grants/actions.ts` builds for grantees, but:
 * self-inclusive (a log's actor is often the current user, not just a
 * grantee); keyed for an arbitrary id set rather than "every other user"; and
 * resolves to `name` rather than `email`. Unlike the owner-only sharing UI
 * (`loadShareState` gates on `permission === "owner"`), the inventory log is
 * readable by view-grantees too (AE3/R8) — surfacing every actor's *email*
 * to that broader audience would leak contact info they may not otherwise
 * have; `name` identifies the actor without that exposure.
 */
export async function namesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
