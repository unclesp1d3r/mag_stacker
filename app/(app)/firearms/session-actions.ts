"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/src/domain/action-result";
import {
  createRangeSession,
  deleteRangeSession,
  listSessionsForFirearm,
  type RangeSession,
  type RangeSessionCreateInput,
  type RangeSessionUpdateInput,
  updateRangeSession,
} from "@/src/domain/range-sessions/service";
import { withActionContext } from "@/src/lib/logging/entry-context";

export async function logRangeSessionAction(
  input: RangeSessionCreateInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("firearm-sessions", async (userId) => {
    const created = await createRangeSession(userId, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id: created.id } };
  });
}

export async function updateRangeSessionAction(
  id: string,
  input: RangeSessionUpdateInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("firearm-sessions", async (userId) => {
    await updateRangeSession(userId, id, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id } };
  });
}

export async function deleteRangeSessionAction(
  id: string,
): Promise<ActionResult> {
  return withActionContext("firearm-sessions", async (userId) => {
    await deleteRangeSession(userId, id);
    revalidatePath("/firearms");
    return { ok: true };
  });
}

/** Read-only history load for the on-demand session panel (no revalidate). */
export async function listRangeSessionsAction(
  firearmId: string,
): Promise<ActionResult<{ sessions: RangeSession[] }>> {
  return withActionContext("firearm-sessions", async (userId) => {
    const sessions = await listSessionsForFirearm(userId, firearmId);
    return { ok: true, data: { sessions } };
  });
}
