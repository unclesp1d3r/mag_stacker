"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import type { ParentType } from "@/src/auth/visibility";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import {
  createLogEntry,
  type LogEntry,
  type LogEntryCreateInput,
  listLogForParent,
  markInventoried,
} from "@/src/domain/inventory-log/service";

/** Mutations resolve the session themselves (R66) before touching the domain. */
async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

/** Shared across the firearm and magazine detail views (one action, one authorization path). */
export async function logEventAction(
  input: LogEntryCreateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await createLogEntry(userId, input);
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function markInventoriedAction(
  parentType: ParentType,
  parentId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await markInventoried(userId, parentType, parentId);
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

/** Read-only history load for the on-demand log panel (no revalidate). */
export async function listLogAction(
  parentType: ParentType,
  parentId: string,
): Promise<ActionResult<{ entries: LogEntry[] }>> {
  try {
    const userId = await requireUserId();
    const entries = await listLogForParent(userId, parentType, parentId);
    return { ok: true, data: { entries } };
  } catch (error) {
    return toActionError(error);
  }
}
