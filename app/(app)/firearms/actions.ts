"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import {
  createFirearm,
  deleteFirearm,
  type FirearmCreateInput,
  updateFirearm,
} from "@/src/domain/firearms/service";

/** Mutations resolve the session themselves (R66) before touching the domain. */
async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

export async function createFirearmAction(
  input: FirearmCreateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await createFirearm(userId, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateFirearmAction(
  id: string,
  input: FirearmCreateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    await updateFirearm(userId, id, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteFirearmAction(id: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await deleteFirearm(userId, id);
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
