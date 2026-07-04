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
    // Single add always creates for the acting user. Force `ownerId` undefined so
    // an injected `ownerId` on the submitted object can't ride into createMagazine's
    // create-on-behalf path — resolveCreateOwner would still gate it on a grant
    // (KTD-5), but single add is not a create-on-behalf surface (bulk add owns that).
    // `labelPrefix` only feeds the prefix list (recordPrefix); it never affects ownership.
    const created = await createMagazine(userId, {
      ...input,
      ownerId: undefined,
      labelPrefix,
    });
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
