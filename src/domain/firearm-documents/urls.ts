/**
 * Client-safe document-URL helpers (U5, U6, U7). No server-only imports — this
 * module is consumed by the client documents section
 * (`app/(app)/firearms/[id]/firearm-documents.tsx`), mirroring the client/server
 * split already used by `constants.ts` in this directory.
 *
 * Both point at the single serving route (`app/api/documents/[id]/route.ts`,
 * U6), which switches disposition on the `disposition` query param — `inline`
 * for the in-app View modal (image/PDF), `attachment` to force a download (R12,
 * R13, R14).
 */

/** Authenticated inline-view URL (opens in the View modal, R14). */
export function documentViewUrl(documentId: string): string {
  return `/api/documents/${documentId}?disposition=inline`;
}

/** Authenticated download URL (forces a save, R13). */
export function documentDownloadUrl(documentId: string): string {
  return `/api/documents/${documentId}?disposition=attachment`;
}
