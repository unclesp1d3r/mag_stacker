/**
 * Firearm-document upload validation (U2). Pure — no DB, no Next.js, no `sharp`,
 * no `file-type`. Mirrors `src/domain/firearm-photos/validate.ts`: returns ALL
 * failure codes together, not first-only, so a caller can surface every problem
 * in one pass (R5).
 *
 * Covers the MIME allow-list and size cap (R5) and the per-request file-count
 * cap. The magic-byte content sniff (also R5) lives in the service (`service.ts`,
 * U5), where the raw bytes are available — it cannot run in this pure module.
 */

import {
  DOC_TYPES,
  type DocType,
  isAllowedMimeType,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_REQUEST,
} from "./constants";

export type DocumentUploadValidationCode =
  | "disallowedMimeType"
  | "fileTooLarge";

export interface DocumentUploadInput {
  mimeType: string;
  sizeBytes: number;
}

/** Validates a single upload's MIME type and size against the controlled caps (R5). */
export function validateDocumentUpload(
  input: DocumentUploadInput,
): DocumentUploadValidationCode[] {
  const codes: DocumentUploadValidationCode[] = [];
  if (!isAllowedMimeType(input.mimeType)) codes.push("disallowedMimeType");
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) codes.push("fileTooLarge");
  return codes;
}

export type BatchSizeValidationCode = "tooManyFiles";

/**
 * Rejects a batch whose file count exceeds the per-request cap, independent of
 * the per-file size limit, so synchronous processing stays within a safe
 * request budget. Checked before any per-file validation or processing runs.
 */
export function assertBatchSize(count: number): BatchSizeValidationCode[] {
  return count > MAX_FILES_PER_REQUEST ? ["tooManyFiles"] : [];
}

const DOC_TYPE_SET: ReadonlySet<string> = new Set(DOC_TYPES);

/** True when `value` is a member of the controlled docType set (R2). */
export function isDocType(value: string): value is DocType {
  return DOC_TYPE_SET.has(value);
}
