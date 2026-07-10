/**
 * Firearm-photo upload pipeline constants (U3). Single source of truth for the
 * controlled MIME allow-list, size/pixel/file-count caps, and derivative
 * dimensions — consumed by the domain validator (`validate.ts`, R9, R26) and
 * the image pipeline (`pipeline.ts`, R9, R11). Mirrors the shape of
 * `src/domain/firearms/constants.ts`.
 */

/** Controlled upload MIME allow-list (R9). SVG and other markup/script-capable formats excluded. */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const ALLOWED_MIME_TYPE_SET: ReadonlySet<string> = new Set(ALLOWED_MIME_TYPES);

/** True when `mimeType` is a member of the controlled upload allow-list (R9). */
export function isAllowedMimeType(
  mimeType: string,
): mimeType is AllowedMimeType {
  return ALLOWED_MIME_TYPE_SET.has(mimeType);
}

/** Maximum accepted upload size, in bytes (R9). */
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

/** Maximum number of files accepted in a single upload request (R26). */
export const MAX_FILES_PER_REQUEST = 10;

/** Longest edge, in pixels, of the generated thumbnail derivative (R11). */
export const THUMB_MAX_EDGE = 200;

/** Longest edge, in pixels, of the generated preview derivative (R11). */
export const PREVIEW_MAX_EDGE = 1024;

/**
 * Upper bound on decoded pixel count (width * height), independent of the
 * compressed file size, so a decompression-bomb image is rejected before it
 * can exhaust memory or CPU (R9). Passed to sharp's `limitInputPixels`.
 */
export const MAX_INPUT_PIXELS = 24_000_000;

/**
 * Maximum number of photos a single firearm may hold (R20) — a per-firearm
 * quota so a low-trust edit-grantee cannot exhaust disk for the whole
 * instance. Enforced by `createPhotos` (U4), independent of the per-request
 * file cap (`MAX_FILES_PER_REQUEST`, R26).
 */
export const MAX_PHOTOS_PER_FIREARM = 50;
