/**
 * Firearm-photo upload validation (U3). Pure — no DB, no Next.js, no `sharp`.
 * Mirrors `src/domain/range-sessions/validate.ts`: returns ALL failure codes
 * together, not first-only, so a caller can surface every problem in one pass.
 *
 * Covers the MIME allow-list and size cap (R9) and the per-request file-count
 * cap (R26). Pixel-bomb rejection (also R9) happens in `pipeline.ts`, where
 * `sharp`'s `limitInputPixels` bounds decoded dimensions independent of the
 * compressed file size — that check requires decoding, so it cannot live here.
 */

import {
  isAllowedMimeType,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_REQUEST,
} from "./constants";

export type PhotoUploadValidationCode = "disallowedMimeType" | "fileTooLarge";

export interface PhotoUploadInput {
  mimeType: string;
  sizeBytes: number;
}

/** Validates a single upload's MIME type and size against the controlled caps (R9). */
export function validatePhotoUpload(
  input: PhotoUploadInput,
): PhotoUploadValidationCode[] {
  const codes: PhotoUploadValidationCode[] = [];
  if (!isAllowedMimeType(input.mimeType)) codes.push("disallowedMimeType");
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) codes.push("fileTooLarge");
  return codes;
}

export type BatchSizeValidationCode = "tooManyFiles";

/**
 * Rejects a batch whose file count exceeds the per-request cap (R26),
 * independent of the per-file size limit, so synchronous processing stays
 * within a safe request budget. Checked before any per-file validation or
 * processing runs.
 */
export function assertBatchSize(count: number): BatchSizeValidationCode[] {
  return count > MAX_FILES_PER_REQUEST ? ["tooManyFiles"] : [];
}
