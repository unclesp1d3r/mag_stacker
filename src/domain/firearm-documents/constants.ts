/**
 * Firearm-document upload constants (U2). Single source of truth for the
 * controlled MIME allow-list, size/file-count/per-firearm caps, and the docType
 * set — consumed by the domain validator (`validate.ts`, R5/R6) and the service
 * (`service.ts`, U5). Mirrors the shape of
 * `src/domain/firearm-photos/constants.ts` but adds `application/pdf` and no
 * pixel/derivative constants (documents stay off the image pipeline, KTD4).
 */

/**
 * Controlled upload MIME allow-list (R5). The photo raster set plus PDF. SVG and
 * other markup/script-capable formats are excluded; the actual content is
 * sniffed against this list by magic bytes in the service (KTD3), not trusted
 * from the client-declared type.
 */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const ALLOWED_MIME_TYPE_SET: ReadonlySet<string> = new Set(ALLOWED_MIME_TYPES);

/** True when `mimeType` is a member of the controlled upload allow-list (R5). */
export function isAllowedMimeType(
  mimeType: string,
): mimeType is AllowedMimeType {
  return ALLOWED_MIME_TYPE_SET.has(mimeType);
}

/** Maximum accepted upload size, in bytes (R5). PDFs run larger than photos. */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Maximum number of files accepted in a single upload request (R6-adjacent batch cap). */
export const MAX_FILES_PER_REQUEST = 10;

/**
 * Maximum number of documents a single firearm may hold (R6) — a per-firearm
 * quota enforced by `createDocuments` (U5), independent of the per-request file
 * cap (`MAX_FILES_PER_REQUEST`).
 */
export const MAX_DOCUMENTS_PER_FIREARM = 50;

/**
 * Controlled docType set (R2). Must stay in sync with the DB check constraint
 * `firearm_document_doc_type_valid` (`src/db/inventory-schema.ts`) — SQL can't
 * import this constant.
 */
export const DOC_TYPES = [
  "receipt",
  "warranty",
  "atf-form-1",
  "atf-form-4",
  "manual",
  "insurance",
  "other",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

/** Default docType when none is supplied (R2). */
export const DEFAULT_DOC_TYPE: DocType = "other";
