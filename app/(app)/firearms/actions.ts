"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/src/domain/action-result";
import {
  createFirearm,
  deleteFirearm,
  type FirearmCreateInput,
  updateFirearm,
} from "@/src/domain/firearms/service";
import { withActionContext } from "@/src/lib/logging/entry-context";

export async function createFirearmAction(
  input: FirearmCreateInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("firearms", async (userId) => {
    const created = await createFirearm(userId, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id: created.id } };
  });
}

export async function updateFirearmAction(
  id: string,
  input: FirearmCreateInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("firearms", async (userId) => {
    await updateFirearm(userId, id, input);
    revalidatePath("/firearms");
    return { ok: true, data: { id } };
  });
}

export async function deleteFirearmAction(id: string): Promise<ActionResult> {
  return withActionContext("firearms", async (userId) => {
    await deleteFirearm(userId, id);
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    return { ok: true };
  });
}
