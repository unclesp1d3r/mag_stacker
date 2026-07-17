"use server";

import { revalidatePath } from "next/cache";
import { createMutationLimiter } from "@/src/auth/rate-limit";
import type { ActionResult } from "@/src/domain/action-result";
import {
  type CreatePhotoInput,
  type CreatePhotoResult,
  createPhotos,
  deletePhoto,
  reorderPhotos,
  setCaption,
  setPrimary,
} from "@/src/domain/firearm-photos/service";
import { withActionContext } from "@/src/lib/logging/entry-context";

/**
 * Dedicated upload rate limiter (KTD9, R20): a per-file cost heavier than the
 * shared `mutationLimiter` since each file triggers synchronous `sharp`
 * processing (decode + two derivative encodes) on top of the write. Consumed
 * before any file is read into memory.
 */
const UPLOAD_POINTS_PER_WINDOW = 120;
const UPLOAD_WINDOW_SECONDS = 60;
const UPLOAD_COST_PER_FILE = 10;

const uploadLimiter = createMutationLimiter({
  points: UPLOAD_POINTS_PER_WINDOW,
  durationSeconds: UPLOAD_WINDOW_SECONDS,
});

/** Both the list view (primary thumbnails) and the detail-view gallery depend
 * on a firearm's photos, so every mutation revalidates both. The detail path
 * is dynamic, so it's revalidated by page pattern rather than a specific id. */
function revalidateFirearmPaths(): void {
  revalidatePath("/firearms");
  revalidatePath("/firearms/[id]", "page");
}

export async function uploadPhotosAction(
  firearmId: string,
  formData: FormData,
): Promise<ActionResult<{ results: CreatePhotoResult[] }>> {
  return withActionContext("firearm-photos", async (userId) => {
    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);

    // Bound synchronous processing load (KTD9, R20) before any file is read.
    await uploadLimiter.consume(
      userId,
      Math.max(1, files.length * UPLOAD_COST_PER_FILE),
    );

    const inputs: CreatePhotoInput[] = await Promise.all(
      files.map(async (file) => ({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        filename: file.name,
      })),
    );

    const results = await createPhotos(userId, firearmId, inputs);
    revalidateFirearmPaths();
    return { ok: true, data: { results } };
  });
}

export async function deletePhotoAction(
  photoId: string,
): Promise<ActionResult> {
  return withActionContext("firearm-photos", async (userId) => {
    await deletePhoto(userId, photoId);
    revalidateFirearmPaths();
    return { ok: true };
  });
}

export async function setPrimaryPhotoAction(
  photoId: string,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("firearm-photos", async (userId) => {
    await setPrimary(userId, photoId);
    revalidateFirearmPaths();
    return { ok: true, data: { id: photoId } };
  });
}

export async function reorderPhotosAction(
  firearmId: string,
  orderedPhotoIds: string[],
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("firearm-photos", async (userId) => {
    await reorderPhotos(userId, firearmId, orderedPhotoIds);
    revalidateFirearmPaths();
    return { ok: true, data: { id: firearmId } };
  });
}

export async function updatePhotoCaptionAction(
  photoId: string,
  caption: string,
): Promise<ActionResult<{ id: string }>> {
  return withActionContext("firearm-photos", async (userId) => {
    await setCaption(userId, photoId, caption);
    revalidateFirearmPaths();
    return { ok: true, data: { id: photoId } };
  });
}
