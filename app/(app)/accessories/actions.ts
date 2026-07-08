"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import {
  type AccessoryCreateInput,
  type AccessoryUpdateInput,
  createAccessory,
  deleteAccessory,
  mountAccessory,
  updateAccessory,
} from "@/src/domain/accessories/service";
import { type ActionResult, toActionError } from "@/src/domain/action-result";

/** Mutations resolve the session themselves (R66) before touching the domain. */
async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

export async function createAccessoryAction(
  input: AccessoryCreateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await createAccessory(userId, input);
    revalidatePath("/accessories");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateAccessoryAction(
  id: string,
  input: AccessoryUpdateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    await updateAccessory(userId, id, input);
    revalidatePath("/accessories");
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteAccessoryAction(id: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await deleteAccessory(userId, id);
    revalidatePath("/accessories");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Mount, reassign, or unmount (`firearmId === null`). The accessory form
 * intentionally can't reach this — `AccessoryUpdateInput` omits `firearmId`
 * (mount is a separate op, see `src/domain/accessories/service.ts`) — so this
 * is called from the detail view's dedicated mount control. Revalidates
 * `/firearms` too since a firearm's mounted-accessories section (U6) depends
 * on this accessory's current mount.
 */
export async function mountAccessoryAction(
  id: string,
  firearmId: string | null,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    await mountAccessory(userId, id, firearmId);
    revalidatePath("/accessories");
    revalidatePath("/firearms");
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionError(error);
  }
}
