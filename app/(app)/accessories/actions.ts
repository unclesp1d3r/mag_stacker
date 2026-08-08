"use server";

import { revalidatePath } from "next/cache";
import {
  type AttachmentFields,
  createAttachment,
  deleteAttachment,
  updateAttachment,
} from "@/src/domain/accessories/attachments";
import {
  type AccessoryCreateInput,
  type AccessoryUpdateInput,
  createAccessory,
  deleteAccessory,
  mountAccessory,
  updateAccessory,
} from "@/src/domain/accessories/service";
import type { ActionResult } from "@/src/domain/action-result";
import { withActionContext } from "@/src/lib/logging/entry-context";

export async function createAccessoryAction(
  input: AccessoryCreateInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("accessories", async (userId) => {
    const created = await createAccessory(userId, input);
    revalidatePath("/accessories");
    return { ok: true, data: { id: created.id } };
  });
}

export async function updateAccessoryAction(
  id: string,
  input: AccessoryUpdateInput,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("accessories", async (userId) => {
    await updateAccessory(userId, id, input);
    revalidatePath("/accessories");
    return { ok: true, data: { id } };
  });
}

export async function deleteAccessoryAction(id: string): Promise<ActionResult> {
  return withActionContext("accessories", async (userId) => {
    await deleteAccessory(userId, id);
    revalidatePath("/accessories");
    return { ok: true };
  });
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
  return withActionContext("accessories", async (userId) => {
    await mountAccessory(userId, id, firearmId);
    revalidatePath("/accessories");
    revalidatePath("/firearms");
    return { ok: true, data: { id } };
  });
}

/**
 * Attachment CRUD (#23 U7). Attachments are child records with no grants of
 * their own — every one of these authorizes through the parent accessory
 * inside the domain layer, so nothing here re-checks permission.
 */
export async function createAttachmentAction(
  accessoryId: string,
  input: AttachmentFields,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("accessories", async (userId) => {
    const created = await createAttachment(userId, accessoryId, input);
    revalidatePath(`/accessories/${accessoryId}`);
    return { ok: true, data: { id: created.id } };
  });
}

/**
 * The parent id comes from the UPDATED ROW, never the caller. These paths key
 * only on `attachmentId`, so a mismatched `{attachmentId, accessoryId}` pair
 * would still update the right attachment while revalidating some other
 * accessory's page — leaving the page that actually changed stale.
 */
export async function updateAttachmentAction(
  attachmentId: string,
  input: AttachmentFields,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("accessories", async (userId) => {
    const updated = await updateAttachment(userId, attachmentId, input);
    revalidatePath(`/accessories/${updated.accessoryId}`);
    return { ok: true, data: { id: attachmentId } };
  });
}

export async function deleteAttachmentAction(
  attachmentId: string,
): Promise<ActionResult> {
  return withActionContext("accessories", async (userId) => {
    const accessoryId = await deleteAttachment(userId, attachmentId);
    revalidatePath(`/accessories/${accessoryId}`);
    return { ok: true };
  });
}
