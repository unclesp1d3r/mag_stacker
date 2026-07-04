"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import {
  type BulkAddOptions,
  type BulkAddTemplate,
  bulkAddMagazines,
} from "@/src/domain/bulkadd/service";
import {
  createMagazine,
  deleteMagazine,
  type MagazineInput,
  updateMagazine,
} from "@/src/domain/magazines/service";

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

export async function createMagazineAction(
  input: MagazineInput,
  labelPrefix?: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    // `labelPrefix` only feeds the prefix list (recordPrefix); it never affects
    // ownership. Create-on-behalf `ownerId` is gated separately by
    // resolveCreateOwner's grant check (KTD-5) — that is the trust boundary here,
    // not this argument's shape.
    const created = await createMagazine(userId, { ...input, labelPrefix });
    revalidatePath("/magazines");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateMagazineAction(
  id: string,
  input: MagazineInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    await updateMagazine(userId, id, input);
    revalidatePath("/magazines");
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteMagazineAction(id: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await deleteMagazine(userId, id);
    revalidatePath("/magazines");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function bulkAddMagazinesAction(
  template: BulkAddTemplate,
  count: number,
  labelPrefix: string,
  options: BulkAddOptions = {},
): Promise<ActionResult<{ created: number }>> {
  try {
    const userId = await requireUserId();
    const created = await bulkAddMagazines(
      userId,
      template,
      count,
      labelPrefix,
      options,
    );
    revalidatePath("/magazines");
    return { ok: true, data: { created: created.length } };
  } catch (error) {
    return toActionError(error);
  }
}
