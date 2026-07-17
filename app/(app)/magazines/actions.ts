"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/src/domain/action-result";
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
import { withActionContext } from "@/src/lib/logging/entry-context";

export async function createMagazineAction(
  input: MagazineInput,
  labelPrefix?: string,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("magazines", async (userId) => {
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
  });
}

export async function updateMagazineAction(
  id: string,
  input: MagazineInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("magazines", async (userId) => {
    await updateMagazine(userId, id, input);
    revalidatePath("/magazines");
    return { ok: true, data: { id } };
  });
}

export async function deleteMagazineAction(id: string): Promise<ActionResult> {
  return withActionContext("magazines", async (userId) => {
    await deleteMagazine(userId, id);
    revalidatePath("/magazines");
    return { ok: true };
  });
}

export async function bulkAddMagazinesAction(
  template: BulkAddTemplate,
  count: number,
  labelPrefix: string,
  options: BulkAddOptions = {},
): Promise<ActionResult<{ created: number }>> {
  return withActionContext("magazines", async (userId) => {
    const created = await bulkAddMagazines(
      userId,
      template,
      count,
      labelPrefix,
      options,
    );
    revalidatePath("/magazines");
    return { ok: true, data: { created: created.length } };
  });
}
