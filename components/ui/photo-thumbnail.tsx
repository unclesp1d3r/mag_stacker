import { ImageOff } from "lucide-react";
import { photoVariantUrl } from "@/src/domain/firearm-photos/urls";
import { cn } from "./cn";

/** Compact-thumbnail footprint (DESIGN.md "sm" fixed height, 32px) — shared by
 * the image and the no-photo placeholder so a row's height never shifts
 * depending on whether a firearm has a primary photo (R17, R22). */
const THUMBNAIL_SIZE = 32;

export interface ThumbnailPhoto {
  id: string;
  mimeType: string;
}

interface PhotoThumbnailProps {
  /** The firearm's primary photo, or `null`/`undefined` when it has none. */
  photo: ThumbnailPhoto | null | undefined;
  /** Accessible name — the firearm's display name (R16). */
  alt: string;
  className?: string;
}

/**
 * Compact primary-photo thumbnail for firearm list rows, cards, and search
 * results (R16, U8). Renders the `thumb` derivative (never the original,
 * R17) through the authenticated serving route, or a fixed-size neutral
 * placeholder when the firearm has no primary (R22) — same footprint either
 * way, so a row's height stays stable.
 */
export function PhotoThumbnail({ photo, alt, className }: PhotoThumbnailProps) {
  if (!photo) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border border-input bg-muted text-ink-soft",
          className,
        )}
        style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
      >
        <ImageOff className="size-4" />
      </span>
    );
  }

  return (
    // biome-ignore lint/performance/noImgElement: served through an authenticated Route Handler (R13), not a public asset next/image's optimizer can fetch.
    <img
      src={photoVariantUrl(photo.id, "thumb")}
      alt={alt}
      width={THUMBNAIL_SIZE}
      height={THUMBNAIL_SIZE}
      loading="lazy"
      className={cn(
        "shrink-0 rounded-md border border-input object-cover",
        className,
      )}
      style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
    />
  );
}
