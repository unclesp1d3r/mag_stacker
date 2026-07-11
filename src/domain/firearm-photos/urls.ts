/**
 * Client-safe photo-URL helper (U6, U7, U8). No server-only imports — this
 * module is consumed by client components (`components/ui/photo-thumbnail.tsx`,
 * `app/(app)/firearms/[id]/firearm-photos.tsx`), mirroring the client/server
 * split already used by `constants.ts` in this directory.
 */

/**
 * The servable photo variants: the stored original plus its derivatives. Single
 * source of truth for the vocabulary — the serving route's validation set
 * (`app/api/photos/[id]/[variant]/route.ts`) and the server-side `PhotoVariant`
 * (`service.ts`) both derive from this, instead of each retyping the literal set
 * and risking drift. Lives in this client-safe module (no server-only imports)
 * so client components can consume it too.
 */
export const PHOTO_VARIANTS = ["original", "thumb", "preview"] as const;

export type PhotoUrlVariant = (typeof PHOTO_VARIANTS)[number];

/** Builds the authenticated serving-route URL for a photo variant (R13, R17). */
export function photoVariantUrl(
  photoId: string,
  variant: PhotoUrlVariant,
): string {
  return `/api/photos/${photoId}/${variant}`;
}
