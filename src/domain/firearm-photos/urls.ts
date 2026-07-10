/**
 * Client-safe photo-URL helper (U6, U7, U8). No server-only imports — this
 * module is consumed by client components (`components/ui/photo-thumbnail.tsx`,
 * `app/(app)/firearms/[id]/firearm-photos.tsx`), mirroring the client/server
 * split already used by `constants.ts` in this directory.
 */

/** A servable photo variant, mirrored from `service.ts`'s `PhotoVariant`
 * without importing that (server-only) module from client components. */
export type PhotoUrlVariant = "original" | "thumb" | "preview";

/** Builds the authenticated serving-route URL for a photo variant (R13, R17). */
export function photoVariantUrl(
  photoId: string,
  variant: PhotoUrlVariant,
): string {
  return `/api/photos/${photoId}/${variant}`;
}
