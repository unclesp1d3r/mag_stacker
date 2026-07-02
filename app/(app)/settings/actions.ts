"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { user as userTable } from "@/src/db/schema";
import { type ActionResult, toActionError } from "@/src/domain/action-result";

async function requireUserId(): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("Unauthenticated");
  return currentUser.id;
}

/**
 * Toggle the caller's Magpul mode preference.
 *
 * Better Auth's `additionalFields` marks `magpulMode` as `input: false`, so
 * the client-facing updateUser API rejects writes to it. We bypass that by
 * writing directly via Drizzle, then revalidate both /settings (so the toggle
 * reflects immediately) and /magazines (so the RSC re-fetches with the new
 * mode and the label field updates without a hard reload).
 */
export async function updateMagpulModeAction(
  enabled: boolean,
): Promise<ActionResult> {
  try {
    if (typeof enabled !== "boolean") {
      return { ok: false, error: "Invalid setting value." };
    }
    const userId = await requireUserId();
    const [updated] = await db
      .update(userTable)
      .set({ magpulMode: enabled })
      .where(eq(userTable.id, userId))
      .returning({ id: userTable.id });
    // Guard against a zero-row write (stale session, deleted account) being
    // silently reported as success — mirrors the .returning() check on the
    // magazine service's update path.
    if (!updated) {
      return { ok: false, error: "Could not save settings." };
    }
    revalidatePath("/settings");
    revalidatePath("/magazines");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
