"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import {
  createRangeSession,
  deleteRangeSession,
  listSessionsForFirearm,
  type RangeSession,
  type RangeSessionCreateInput,
  type RangeSessionUpdateInput,
  updateRangeSession,
} from "@/src/domain/range-sessions/service";

/** Mutations resolve the session themselves (R66) before touching the domain. */
async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

export async function logRangeSessionAction(
  input: RangeSessionCreateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await createRangeSession(userId, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateRangeSessionAction(
  id: string,
  input: RangeSessionUpdateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    await updateRangeSession(userId, id, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteRangeSessionAction(
  id: string,
): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await deleteRangeSession(userId, id);
    revalidatePath("/firearms");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Read-only history load for the on-demand session panel (no revalidate). */
export async function listRangeSessionsAction(
  firearmId: string,
): Promise<ActionResult<{ sessions: RangeSession[] }>> {
  try {
    const userId = await requireUserId();
    const sessions = await listSessionsForFirearm(userId, firearmId);
    return { ok: true, data: { sessions } };
  } catch (error) {
    return toActionError(error);
  }
}
