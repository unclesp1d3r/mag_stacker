"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/src/domain/action-result";
import {
  type AmmoInput,
  createAmmo,
  deleteAmmo,
  updateAmmo,
} from "@/src/domain/ammo/service";
import { withActionContext } from "@/src/lib/logging/entry-context";

export async function createAmmoAction(
  input: AmmoInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("ammo", async (userId) => {
    const created = await createAmmo(userId, input);
    revalidatePath("/ammo");
    return { ok: true, data: { id: created.id } };
  });
}

export async function updateAmmoAction(
  id: string,
  input: AmmoInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("ammo", async (userId) => {
    await updateAmmo(userId, id, input);
    revalidatePath("/ammo");
    return { ok: true, data: { id } };
  });
}

export async function deleteAmmoAction(id: string): Promise<ActionResult> {
  return withActionContext("ammo", async (userId) => {
    await deleteAmmo(userId, id);
    revalidatePath("/ammo");
    return { ok: true };
  });
}
