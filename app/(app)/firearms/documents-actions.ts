"use server";

import { revalidatePath } from "next/cache";
import { createMutationLimiter } from "@/src/auth/rate-limit";
import { getCurrentUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import {
  type CreateDocumentClientResult,
  toFirearmDocumentRow,
} from "@/src/domain/firearm-documents/row";
import {
  type CreateDocumentInput,
  createDocuments,
  deleteDocument,
} from "@/src/domain/firearm-documents/service";

/** Mutations resolve the session themselves (R66/mirrors photo-actions) before touching the domain. */
async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

/**
 * Dedicated upload rate limiter (mirrors photo-actions' `uploadLimiter`): a
 * per-file cost heavier than the shared `mutationLimiter` since each file
 * triggers a blob write on top of the row insert. Consumed before any file is
 * read into memory.
 */
const UPLOAD_POINTS_PER_WINDOW = 120;
const UPLOAD_WINDOW_SECONDS = 60;
const UPLOAD_COST_PER_FILE = 10;

const uploadLimiter = createMutationLimiter({
  points: UPLOAD_POINTS_PER_WINDOW,
  durationSeconds: UPLOAD_WINDOW_SECONDS,
});

/** The owner-only documents section on the detail view depends on a firearm's
 * documents, so every mutation revalidates that path. The detail path is
 * dynamic, so it's revalidated by page pattern rather than a specific id. */
function revalidateFirearmPaths(): void {
  revalidatePath("/firearms/[id]", "page");
}

export async function uploadDocumentsAction(
  firearmId: string,
  formData: FormData,
): Promise<ActionResult<{ results: CreateDocumentClientResult[] }>> {
  try {
    const userId = await requireUserId();
    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
    const docType = formData.get("docType");
    const notes = formData.get("notes");

    // Bound synchronous processing load before any file is read.
    await uploadLimiter.consume(
      userId,
      Math.max(1, files.length * UPLOAD_COST_PER_FILE),
    );

    const inputs: CreateDocumentInput[] = await Promise.all(
      files.map(async (file) => ({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        filename: file.name,
        docType: typeof docType === "string" ? docType : undefined,
        notes: typeof notes === "string" ? notes : undefined,
      })),
    );

    const results = await createDocuments(userId, firearmId, inputs);
    // Narrow each success to the client-safe row so `storageKey` never ships to
    // the client in the action response (R10) — the client only reads ok/codes.
    const clientResults: CreateDocumentClientResult[] = results.map((result) =>
      result.ok
        ? { ok: true, document: toFirearmDocumentRow(result.document) }
        : result,
    );
    revalidateFirearmPaths();
    return { ok: true, data: { results: clientResults } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteDocumentAction(
  documentId: string,
): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await deleteDocument(userId, documentId);
    revalidateFirearmPaths();
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
