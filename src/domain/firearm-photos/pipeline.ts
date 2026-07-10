import type { Sharp } from "sharp";
import sharp from "sharp";
import {
  type AllowedMimeType,
  isAllowedRasterFormat,
  MAX_INPUT_PIXELS,
  PREVIEW_MAX_EDGE,
  THUMB_MAX_EDGE,
} from "./constants";

export interface ProcessedImage {
  original: Buffer;
  thumb: Buffer;
  preview: Buffer;
  width: number;
  height: number;
}

/**
 * Turns raw uploaded bytes into a validated, location-metadata-stripped
 * original plus thumbnail/preview derivatives (R4, R9, R10, R11).
 *
 * Generic validate/persist stays in `validate.ts` and the caller (U4); this
 * module only transforms bytes, keeping the image-specific stages isolated
 * (R4) so a non-image attachment feature (#12) can skip them entirely.
 *
 * Re-encoding through `sharp` WITHOUT `.withMetadata()`/`.keepExif()` drops
 * all embedded metadata by default — EXIF (including GPS carried in an
 * embedded EXIF thumbnail), XMP, and IPTC — satisfying R10 without
 * tag-by-tag stripping (KTD4).
 *
 * `limitInputPixels` bounds decoded pixel count independent of the
 * compressed file size, so a decompression-bomb image is rejected before it
 * can exhaust memory or CPU (R9).
 *
 * Rejects on decode failure (corrupt/truncated input) or when the pixel cap
 * is exceeded; the caller (U4) treats any rejection as a per-file failure,
 * never aborting the rest of a batch (R21).
 */
export async function processImage(
  bytes: Uint8Array | Buffer,
  mimeType: AllowedMimeType,
): Promise<ProcessedImage> {
  const metadata = await sharp(bytes, {
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();

  // `.metadata()` reads header bytes only — it does not rasterize and so
  // cannot trigger the SSRF this guard defends against. Reject BEFORE the
  // re-encode below (which does rasterize) so an SVG (or any other
  // non-raster format) mislabeled with an allowed MIME type never reaches a
  // format-specific loader (R9, format-confusion SSRF hardening).
  if (!isAllowedRasterFormat(metadata.format)) {
    throw new Error(
      `firearm-photos/pipeline: unsupported image format "${metadata.format ?? "unknown"}"`,
    );
  }

  const { width, height } = metadata;
  if (!width || !height) {
    throw new Error(
      "firearm-photos/pipeline: unable to determine image dimensions",
    );
  }

  // The three re-encodes are independent — each builds its own fresh `sharp`
  // pipeline (see `reencode`) — so they run concurrently rather than
  // sequentially.
  const [original, thumb, preview] = await Promise.all([
    reencode(bytes, mimeType).toBuffer(),
    reencode(bytes, mimeType)
      .resize({
        width: THUMB_MAX_EDGE,
        height: THUMB_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer(),
    reencode(bytes, mimeType)
      .resize({
        width: PREVIEW_MAX_EDGE,
        height: PREVIEW_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer(),
  ]);

  return { original, thumb, preview, width, height };
}

/**
 * Builds a fresh `sharp` pipeline for `bytes`, bounded by the shared pixel
 * cap, and re-encodes it to the format matching `mimeType`. A fresh instance
 * per output (rather than `.clone()`) keeps each derivative's pipeline
 * independent and side-effect free.
 */
function reencode(
  bytes: Uint8Array | Buffer,
  mimeType: AllowedMimeType,
): Sharp {
  const pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
  switch (mimeType) {
    case "image/jpeg":
      return pipeline.jpeg();
    case "image/png":
      return pipeline.png();
    case "image/webp":
      return pipeline.webp();
    case "image/avif":
      return pipeline.avif();
    default:
      throw new Error(
        `firearm-photos/pipeline: unsupported mime type "${mimeType}"`,
      );
  }
}
