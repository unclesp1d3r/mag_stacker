import { asc, ne } from "drizzle-orm";
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
