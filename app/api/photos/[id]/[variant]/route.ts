import { getCurrentUser } from "@/src/auth/session";
import {
  getServablePhoto,
  type PhotoVariant,
} from "@/src/domain/firearm-photos/service";
import { PHOTO_VARIANTS } from "@/src/domain/firearm-photos/urls";
import { withRequestContext } from "@/src/lib/logging/entry-context";
import { isUuid } from "@/src/lib/uuid";

interface RouteParams {
  params: Promise<{ id: string; variant: string }>;
}

const VALID_VARIANTS: ReadonlySet<string> = new Set(PHOTO_VARIANTS);

function isPhotoVariant(value: string): value is PhotoVariant {
  return VALID_VARIANTS.has(value);
}

/** A year is a safe long-lived cache: each storage key is server-generated
 * and immutable once written — the original/derivative blobs behind a given
 * key never change (a caption/reorder/primary edit never rewrites a blob). */
const CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Authenticated photo-serving Route Handler (U6, KTD6, R12, R13). Server
 * Actions can't return binary GET responses, so serving lives here instead
 * of `photo-actions.ts`. Re-resolves the session in-handler (the real
 * authorization boundary, R66 — `proxy.ts`'s cookie check is optimistic
 * only) and authorizes against the parent firearm via `getServablePhoto`.
 * `Content-Type` is pinned from the STORED `mimeType`, never client-supplied
 * (R13), alongside `X-Content-Type-Options: nosniff` so stored bytes can
 * never execute as script in another user's session.
 */
export const GET = withRequestContext(
  "photos",
  async (_request: Request, { params }: RouteParams): Promise<Response> => {
    const { id, variant } = await params;

    if (!isPhotoVariant(variant)) {
      return new Response(null, { status: 400 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return new Response(null, { status: 401 });
    }

    // A malformed id can match no record anyway; treat it as not-found at the
    // boundary rather than let the uuid column raise a cast error (mirrors the
    // firearm detail page's `isUuid` guard). Existence-hiding: a denied grant
    // and an absent/malformed id are indistinguishable to the caller (AE2).
    if (!isUuid(id)) {
      return new Response(null, { status: 404 });
    }

    const photo = await getServablePhoto(user.id, id, variant);
    if (!photo) {
      return new Response(null, { status: 404 });
    }

    // A zero-copy Uint8Array VIEW over the Buffer's existing memory (matching its
    // offset/length), rather than `new Uint8Array(photo.bytes)` which copies every
    // image byte into a second allocation per request. The `as ArrayBuffer` cast
    // narrows Buffer's `ArrayBufferLike` backing (which BodyInit rejects as it
    // admits SharedArrayBuffer): a Buffer from `fs.readFile` is always backed by a
    // real ArrayBuffer, never shared.
    const body = new Uint8Array(
      photo.bytes.buffer as ArrayBuffer,
      photo.bytes.byteOffset,
      photo.bytes.byteLength,
    );
    return new Response(body, {
      headers: {
        "Content-Type": photo.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": `private, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`,
      },
    });
  },
);
