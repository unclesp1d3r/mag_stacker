"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import {
  type AmmoInput,
  createAmmo,
  deleteAmmo,
  updateAmmo,
} from "@/src/domain/ammo/service";

/** Mutations resolve the session themselves (R66) before touching the domain. */
async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

export async function createAmmoAction(
  input: AmmoInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await createAmmo(userId, input);
    revalidatePath("/ammo");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateAmmoAction(
  id: string,
  input: AmmoInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    await updateAmmo(userId, id, input);
    revalidatePath("/ammo");
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteAmmoAction(id: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await deleteAmmo(userId, id);
    revalidatePath("/ammo");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
