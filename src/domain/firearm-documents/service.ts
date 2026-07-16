import { desc, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import {
  authorizeDelete,
  authorizeOwnerOnlyRead,
  authorizeOwnerOnlyUpdate,
} from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { type DbOrTx, db } from "@/src/db/client";
import { firearm, firearmDocument } from "@/src/db/schema";
import { childLogger } from "@/src/lib/logging";
import { deleteDocumentBlob, generateKey, storage } from "@/src/storage";
import { ValidationError } from "../errors";
import {
  type AllowedMimeType,
  DEFAULT_DOC_TYPE,
  type DocType,
  isAllowedMimeType,
  MAX_DOCUMENTS_PER_FIREARM,
  MAX_NOTES_LENGTH,
} from "./constants";
import { sanitizeFilename } from "./sanitize-filename";
import {
  assertBatchSize,
  type BatchSizeValidationCode,
  type DocumentUploadValidationCode,
  isDocType,
  validateDocumentUpload,
} from "./validate";

/**
 * Firearm-document service (#12, U5). Documents are a firearm child but
 * OWNER-ONLY on every operation (KTD1) — unlike photos, a view- or edit-grantee
 * may not list, view, download, or delete them. Every entry point authorizes
 * through the parent firearm's owner-only gate BEFORE any per-file work, so an
 * invisible/forbidden firearm always yields NotFound/NotAuthorized and never
 * leaks that a document (or its parent) exists (R8, R9, existence-hiding).
 *
 * Documents stay off the image pipeline (KTD4): a single blob per document, no
 * `sharp` decode/re-encode, no derivatives. Upload validation adds a magic-byte
 * content sniff (KTD3) so the stored MIME reflects the real bytes, not the
 * client-declared type.
 */

const log = childLogger("firearm-documents");

export type FirearmDocument = typeof firearmDocument.$inferSelect;

/** One file offered to `createDocuments`. `mimeType`/`filename` are the
 * client-declared values; the real MIME is sniffed from `bytes` (KTD3) and the
 * filename is sanitized before storage (KTD6). */
export interface CreateDocumentInput {
  bytes: Uint8Array | Buffer;
  mimeType: string;
  filename: string;
  docType?: string;
  notes?: string;
}

export type CreateDocumentFailureCode =
  | DocumentUploadValidationCode
  // The sniffed content type is undefined or outside the allow-list — the file
  // is not actually one of the accepted types regardless of its declared MIME.
  | "contentMismatch"
  // The blob write to storage failed (disk/permission/transient) — an
  // infrastructure error, distinct from a bad file, so the user is told to
  // retry rather than to pick a different file.
  | "uploadFailed";

export type CreateDocumentResult =
  | { ok: true; document: FirearmDocument }
  | { ok: false; codes: CreateDocumentFailureCode[] };

/**
 * Every code a `createDocuments` call can surface: the per-file failure codes
 * plus the whole-call codes thrown as a `ValidationError` (the batch-size cap
 * and the per-firearm quota). Single source of truth for the upload UI's
 * message map (U7).
 */
export type CreateDocumentErrorCode =
  | CreateDocumentFailureCode
  | BatchSizeValidationCode
  | "documentQuotaExceeded";

const EXTENSION_BY_MIME_TYPE: Record<AllowedMimeType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Look up a document's parent firearm, or not-found if the document is absent. */
async function firearmIdFor(tx: DbOrTx, id: string): Promise<string> {
  const [row] = await tx
    .select({ firearmId: firearmDocument.firearmId })
    .from(firearmDocument)
    .where(eq(firearmDocument.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.firearmId;
}

/** Normalize a caller-supplied docType to the controlled set, defaulting. */
function resolveDocType(value: string | undefined): DocType {
  return value !== undefined && isDocType(value) ? value : DEFAULT_DOC_TYPE;
}

/** A file that cleared validation + the content sniff: its blob is already
 * written to storage, awaiting its DB row. `index` ties the row back to the
 * right slot of the returned per-file result array. */
interface PreparedDocument {
  index: number;
  key: string;
  filename: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  docType: DocType;
  notes: string;
}

/** A file that cleared validation + the content sniff (no blob written yet),
 * with its resolved allow-listed MIME. */
interface ValidatedFile {
  index: number;
  buffer: Buffer;
  mime: AllowedMimeType;
  sizeBytes: number;
  filename: string;
  docType: DocType;
  notes: string;
}

/**
 * Magic-byte content sniff (KTD3, R5): returns the file's real allow-listed
 * MIME, or null when the bytes aren't a known allowed type. `fileTypeFromBuffer`
 * can THROW on a corrupt/adversarial buffer (its detectors rethrow non-EOF
 * errors), so the throw is guarded and treated as "not a known type" — never an
 * exception that aborts the whole batch and orphans earlier files' blobs.
 */
async function sniffAllowedMime(
  buffer: Buffer,
  firearmId: string,
): Promise<AllowedMimeType | null> {
  let sniffed: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    sniffed = await fileTypeFromBuffer(buffer);
  } catch (error) {
    log.error({ err: error, firearmId }, "fileTypeFromBuffer threw");
    return null;
  }
  return sniffed !== undefined && isAllowedMimeType(sniffed.mime)
    ? sniffed.mime
    : null;
}

/**
 * Upload one or more documents to a firearm (F1, R4-R8). OWNER access is
 * authorized up front (before any per-file work, existence-hiding), then the
 * per-request cap and an optimistic per-firearm quota (R6) reject an over-limit
 * call before anything is stored.
 *
 * Each file is validated (declared MIME + size, R5), content-sniffed by magic
 * bytes (KTD3 — the sniffed type must be in the allow-list, otherwise the file
 * is rejected as content-mismatch regardless of its declared type), its
 * filename sanitized (KTD6), and its single blob written to storage
 * INDEPENDENTLY and OUTSIDE any transaction: a failure on one file becomes that
 * file's result without aborting the batch. Only the successful files' row
 * inserts run in a short transaction that re-authorizes, locks the firearm row,
 * and re-checks the quota atomically against concurrent uploads. If that
 * transaction rolls back, the already-written blobs are deleted directly rather
 * than left for the orphan sweep. The caller gets a per-file result in input
 * order.
 */
export async function createDocuments(
  actorId: string,
  firearmId: string,
  inputs: CreateDocumentInput[],
): Promise<CreateDocumentResult[]> {
  // Authorize first (owner-only, existence-hiding), then the per-request cap.
  await authorizeOwnerOnlyUpdate(db, actorId, "firearm", firearmId);

  const batchSizeCodes = assertBatchSize(inputs.length);
  if (batchSizeCodes.length > 0) throw new ValidationError(batchSizeCodes);

  // Phase 1 — validate + content-sniff every file (no blob I/O yet). Splitting
  // validation from the blob writes lets the quota check count only the files
  // that would actually persist, so a mixed valid/invalid batch is never
  // rejected wholesale when the valid subset fits, and no bytes are written for
  // a batch that will be rejected.
  const results = new Array<CreateDocumentResult>(inputs.length);
  const validated: ValidatedFile[] = [];
  for (const [index, input] of inputs.entries()) {
    // Actual uploaded-buffer length, not a caller-declared field.
    const sizeBytes = input.bytes.byteLength;
    const codes: CreateDocumentFailureCode[] = validateDocumentUpload({
      mimeType: input.mimeType,
      sizeBytes,
    });
    const buffer = Buffer.isBuffer(input.bytes)
      ? input.bytes
      : Buffer.from(input.bytes);
    // The stored MIME reflects the real bytes (KTD3), not the declared type;
    // null means the bytes aren't a known allowed type (catches an HTML/script
    // payload mislabeled as an image).
    const mime = await sniffAllowedMime(buffer, firearmId);
    if (mime === null && !codes.includes("contentMismatch")) {
      codes.push("contentMismatch");
    }
    if (codes.length > 0 || mime === null) {
      results[index] = {
        ok: false,
        codes: codes.length > 0 ? codes : ["contentMismatch"],
      };
      continue;
    }
    validated.push({
      index,
      buffer,
      mime,
      sizeBytes,
      filename: sanitizeFilename(input.filename),
      docType: resolveDocType(input.docType),
      notes: (input.notes ?? "").slice(0, MAX_NOTES_LENGTH),
    });
  }

  if (validated.length === 0) return results;

  // Optimistic (unlocked) quota check — counts only files that passed
  // validation (would persist). The authoritative, race-safe check runs under a
  // row lock in the transaction below.
  const existing = await db
    .select({ id: firearmDocument.id })
    .from(firearmDocument)
    .where(eq(firearmDocument.firearmId, firearmId));
  if (existing.length + validated.length > MAX_DOCUMENTS_PER_FIREARM) {
    throw new ValidationError([
      "documentQuotaExceeded",
    ] satisfies CreateDocumentErrorCode[]);
  }

  // Phase 2 — write each validated file's single blob to storage, OUTSIDE any
  // transaction. A storage failure becomes that file's result without aborting
  // the batch; the blobs await their DB rows.
  const prepared: PreparedDocument[] = [];
  for (const file of validated) {
    const key = generateKey(EXTENSION_BY_MIME_TYPE[file.mime]);
    try {
      await storage.save(key, file.buffer);
    } catch (error) {
      log.error({ err: error, firearmId }, "storage.save failed");
      await deleteDocumentBlob(key);
      results[file.index] = { ok: false, codes: ["uploadFailed"] };
      continue;
    }
    prepared.push({
      index: file.index,
      key,
      filename: file.filename,
      mimeType: file.mime,
      sizeBytes: file.sizeBytes,
      docType: file.docType,
      notes: file.notes,
    });
  }

  if (prepared.length === 0) return results;

  try {
    await db.transaction(async (tx) => {
      // Re-authorize under the lock in case a grant/ownership changed during the
      // (possibly seconds-long) IO above, lock the firearm row so the quota read
      // + inserts are atomic against a concurrent upload, then insert.
      await authorizeOwnerOnlyUpdate(tx, actorId, "firearm", firearmId);
      const [lockedFirearm] = await tx
        .select({ id: firearm.id })
        .from(firearm)
        .where(eq(firearm.id, firearmId))
        .for("update")
        .limit(1);
      if (!lockedFirearm) throw new NotFoundError();

      const existing = await tx
        .select({ id: firearmDocument.id })
        .from(firearmDocument)
        .where(eq(firearmDocument.firearmId, firearmId));

      if (existing.length + prepared.length > MAX_DOCUMENTS_PER_FIREARM) {
        throw new ValidationError([
          "documentQuotaExceeded",
        ] satisfies CreateDocumentErrorCode[]);
      }

      // Single multi-row insert rather than one round-trip per file: keeps the
      // FOR UPDATE lock window to one statement. Postgres preserves VALUES order
      // in RETURNING, so `inserted[i]` maps back to `prepared[i]`.
      const inserted = await tx
        .insert(firearmDocument)
        .values(
          prepared.map((p) => ({
            firearmId,
            storageKey: p.key,
            filename: p.filename,
            mimeType: p.mimeType,
            sizeBytes: p.sizeBytes,
            docType: p.docType,
            notes: p.notes,
          })),
        )
        .returning();
      prepared.forEach((p, i) => {
        results[p.index] = { ok: true, document: inserted[i] };
      });
    });
  } catch (error) {
    // The transaction rolled back, so none of the prepared rows persisted —
    // every prepared blob is now orphaned. Reclaim them directly (best-effort).
    await Promise.all(prepared.map((p) => deleteDocumentBlob(p.key)));
    throw error;
  }

  return results;
}

/**
 * A firearm's documents, most-recently-uploaded first (R25). OWNER-ONLY (R16):
 * a view- or edit-grantee is refused; a firearm outside the actor's visible set
 * is not-found (existence is never revealed).
 */
export async function listDocuments(
  actorId: string,
  firearmId: string,
): Promise<FirearmDocument[]> {
  await authorizeOwnerOnlyRead(db, actorId, "firearm", firearmId);
  return db
    .select()
    .from(firearmDocument)
    .where(eq(firearmDocument.firearmId, firearmId))
    .orderBy(desc(firearmDocument.uploadedAt));
}

/**
 * Delete a single document (F5, R18): owner-only. Removes the row in a
 * transaction, then best-effort deletes its single blob AFTER the delete
 * commits (so a blob-delete failure can never orphan a still-live row — the
 * benign residue the orphan sweep handles).
 */
export async function deleteDocument(
  actorId: string,
  documentId: string,
): Promise<void> {
  const storageKey = await db.transaction(async (tx) => {
    const firearmId = await firearmIdFor(tx, documentId);
    await authorizeDelete(tx, actorId, "firearm", firearmId);

    const [deleted] = await tx
      .delete(firearmDocument)
      .where(eq(firearmDocument.id, documentId))
      .returning();
    if (!deleted) throw new NotFoundError();
    return deleted.storageKey;
  });

  await deleteDocumentBlob(storageKey);
}

export interface ServableDocument {
  bytes: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Resolve a document's bytes + stored MIME + filename for authenticated,
 * owner-only streaming (U6, R10). Authz is OWNER-ONLY on the parent firearm
 * (`authorizeOwnerOnlyRead`) — it throws NotAuthorized for a visible non-owner
 * and NotFound for an unseen firearm; the serving route collapses both (and a
 * null return) to a bare 404 (KTD2). Returns null when the document id doesn't
 * exist.
 */
export async function getServableDocument(
  actorId: string,
  documentId: string,
): Promise<ServableDocument | null> {
  const [row] = await db
    .select({
      firearmId: firearmDocument.firearmId,
      storageKey: firearmDocument.storageKey,
      mimeType: firearmDocument.mimeType,
      filename: firearmDocument.filename,
    })
    .from(firearmDocument)
    .where(eq(firearmDocument.id, documentId))
    .limit(1);
  if (!row) return null;

  await authorizeOwnerOnlyRead(db, actorId, "firearm", row.firearmId);

  // A read failure here is the "row survives, blob is gone" case orphanSweep
  // cannot repair — log the identifying context (never the filename/notes PII)
  // before rethrowing so the broken document is findable, then let the route
  // surface it (a 500, distinct from the owner-only 404 collapse).
  const bytes = await storage.read(row.storageKey).catch((error: unknown) => {
    log.error(
      {
        err: error,
        documentId,
        firearmId: row.firearmId,
        storageKey: row.storageKey,
      },
      "storage.read failed",
    );
    throw error;
  });
  return { bytes, mimeType: row.mimeType, filename: row.filename };
}
