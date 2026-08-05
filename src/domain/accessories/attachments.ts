import { asc, eq } from "drizzle-orm";
import {
  requireAccessoryEdit,
  requireAccessoryView,
} from "@/src/auth/accessory-visibility";
import { NotFoundError } from "@/src/auth/errors";
import { type DbOrTx, db } from "@/src/db/client";
import { accessoryAttachment } from "@/src/db/schema";
import { ValidationError } from "../errors";
import { isAttachmentType } from "./constants";

/**
 * Accessory attachments (#23 U3, R11/R12/R13) — the mounting hardware that
 * makes a serialized accessory fit a host: mounts, pistons, end caps, muzzle
 * devices.
 *
 * These are CHILD RECORDS of the accessory (KTD7, the `firearm_photo` mold):
 * no `owner_id`, no grants of their own. Every function here resolves
 * authorization through the parent accessory, which is what guarantees an
 * attachment can never be reachable by someone who cannot reach the accessory
 * — including after #23 made accessories independently shareable, since the
 * parent gate is the single place that decision lands.
 *
 * Recording an attachment deliberately does NOT touch compatibility. A piston
 * is what makes a can fit a host, but DERIVING suggested compatibility from it
 * is explicitly deferred (#23 scope boundaries), so nothing here writes to
 * `accessory_firearm`.
 */

export type AccessoryAttachment = typeof accessoryAttachment.$inferSelect;

export type AttachmentValidationCode = "invalidAttachmentType";

export interface AttachmentFields {
  /** Controlled part kind (R11). Required. */
  type: string;
  /** Thread pitch / bore / free-text identifier (R12). */
  spec?: string;
  serialNumber?: string;
  notes?: string;
}

/** Pure validation, mirroring the other domain validators' all-codes shape. */
export function validateAttachment(
  input: AttachmentFields,
): AttachmentValidationCode[] {
  const codes: AttachmentValidationCode[] = [];
  if (!isAttachmentType(input.type)) codes.push("invalidAttachmentType");
  return codes;
}

/** Optional text is empty-not-null (R18); `type` is validated before any write. */
function persistableFields(input: AttachmentFields) {
  return {
    type: input.type,
    spec: (input.spec ?? "").trim(),
    serialNumber: (input.serialNumber ?? "").trim(),
    notes: input.notes ?? "",
  };
}

/**
 * Resolve an attachment's parent accessory id, or not-found.
 *
 * Every mutating path goes through this first: the caller addresses an
 * ATTACHMENT by id, but the permission lives on the parent, so the parent has
 * to be looked up before anything is authorized. Doing it in one helper is
 * what stops a future path from checking permission on the wrong row.
 */
async function parentAccessoryId(
  tx: DbOrTx,
  attachmentId: string,
): Promise<string> {
  const [row] = await tx
    .select({ accessoryId: accessoryAttachment.accessoryId })
    .from(accessoryAttachment)
    .where(eq(accessoryAttachment.id, attachmentId))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.accessoryId;
}

/**
 * An accessory's attachments in creation order. Requires any level of access
 * to the parent (owner/edit/view) — a viewer sees the list, per R17.
 */
export async function listAttachments(
  actorId: string,
  accessoryId: string,
): Promise<AccessoryAttachment[]> {
  await requireAccessoryView(db, actorId, accessoryId);
  return db
    .select()
    .from(accessoryAttachment)
    .where(eq(accessoryAttachment.accessoryId, accessoryId))
    .orderBy(asc(accessoryAttachment.createdAt), asc(accessoryAttachment.id));
}

export async function createAttachment(
  actorId: string,
  accessoryId: string,
  input: AttachmentFields,
): Promise<AccessoryAttachment> {
  const codes = validateAttachment(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    await requireAccessoryEdit(tx, actorId, accessoryId);
    const [row] = await tx
      .insert(accessoryAttachment)
      .values({ accessoryId, ...persistableFields(input) })
      .returning();
    return row;
  });
}

export async function updateAttachment(
  actorId: string,
  attachmentId: string,
  input: AttachmentFields,
): Promise<AccessoryAttachment> {
  const codes = validateAttachment(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    const accessoryId = await parentAccessoryId(tx, attachmentId);
    await requireAccessoryEdit(tx, actorId, accessoryId);
    const [row] = await tx
      .update(accessoryAttachment)
      .set({ ...persistableFields(input), updatedAt: new Date() })
      .where(eq(accessoryAttachment.id, attachmentId))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

export async function deleteAttachment(
  actorId: string,
  attachmentId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const accessoryId = await parentAccessoryId(tx, attachmentId);
    await requireAccessoryEdit(tx, actorId, accessoryId);
    const deleted = await tx
      .delete(accessoryAttachment)
      .where(eq(accessoryAttachment.id, attachmentId))
      .returning({ id: accessoryAttachment.id });
    if (deleted.length === 0) throw new NotFoundError();
  });
}
