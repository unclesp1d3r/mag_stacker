import { notFound } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";

/**
 * Shared 404 guard for detail-page loaders that authorize internally (e.g.
 * `listPhotos`, `listDocuments`, `getItemDueState`, `listItemRules`,
 * `listServiceHistory`). A page resolves the viewer's permission once, up
 * front (`getFirearm` / `getAccessory`), then makes further loader calls in
 * parallel — if access is revoked (or the row is deleted) between that first
 * check and one of these later calls, the loader throws `NotFoundError` for
 * the same reason the first check would have. That must surface as the
 * page's clean 404, not an unhandled 500 from Next's generic error boundary.
 *
 * Usage: `someLoader(...).catch(asNotFound)`.
 */
export function asNotFound(error: unknown): never {
  if (error instanceof NotFoundError) notFound();
  throw error;
}
