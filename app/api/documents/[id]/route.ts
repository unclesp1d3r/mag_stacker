import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { isAllowedMimeType } from "@/src/domain/firearm-documents/constants";
import { getServableDocument } from "@/src/domain/firearm-documents/service";
import { withRequestContext } from "@/src/lib/logging/entry-context";
import { isUuid } from "@/src/lib/uuid";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Build an RFC 6266 `Content-Disposition` value that survives non-ASCII
 * filenames (KTD6, R13): an ASCII-only `filename="..."` fallback for legacy
 * clients plus a `filename*=UTF-8''...` percent-encoded form. Without the
 * `filename*` form, a non-Latin1 name (e.g. a scanned CJK import permit) would
 * throw when the `Headers` object is constructed or render as mojibake. The
 * name has already been sanitized (no CR/LF/control chars) so header injection
 * is not possible here.
 */
function contentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  // ASCII fallback: drop any byte outside printable ASCII, and quotes/backslash
  // that would break the quoted-string.
  const asciiFallback =
    filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "document";
  // encodeURIComponent leaves ! ' ( ) * ~ raw, but RFC 5987's attr-char grammar
  // (used by RFC 6266's ext-value) excludes ' ( ) * — percent-escape those so
  // the filename* value is spec-conformant.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Authenticated, OWNER-ONLY document-serving Route Handler (U6, KTD2/KTD5/KTD6,
 * R10, R13, R14, R15). Server Actions can't return binary GET responses, so
 * serving lives here. Re-resolves the session in-handler (the real
 * authorization boundary) and authorizes owner-only against the parent firearm
 * via `getServableDocument`.
 *
 * Existence-hiding is stricter than the rest of the feature (KTD2): every
 * failure — missing document, unseen firearm, OR a visible non-owner — collapses
 * to a bare 404, so raw bytes are maximally hidden and a random document id
 * reveals nothing on enumeration.
 *
 * `?disposition=inline` opens the bytes in-app (the View modal); anything else
 * (default) forces a download. `inline` is honored ONLY for the whitelisted safe
 * MIME types (PDF + the image set) and always ships the hardened headers:
 * `X-Content-Type-Options: nosniff` and `Content-Security-Policy:
 * frame-ancestors 'self'` (R15). `Content-Type` is pinned from the STORED
 * `mimeType`, never client-supplied.
 */
export const GET = withRequestContext(
  "documents",
  async (request: Request, { params }: RouteParams): Promise<Response> => {
    const { id } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return new Response(null, { status: 401 });
    }

    // A malformed id matches no record; treat it as not-found at the boundary
    // rather than let the uuid column raise a cast error. Existence-hiding: a
    // denied owner-only check and an absent/malformed id are indistinguishable.
    if (!isUuid(id)) {
      return new Response(null, { status: 404 });
    }

    let doc: Awaited<ReturnType<typeof getServableDocument>>;
    try {
      doc = await getServableDocument(user.id, id);
    } catch (error) {
      // Collapse every owner-only authorization failure to 404 (KTD2).
      if (
        error instanceof NotAuthorizedError ||
        error instanceof NotFoundError
      ) {
        return new Response(null, { status: 404 });
      }
      throw error;
    }
    if (!doc) {
      return new Response(null, { status: 404 });
    }

    // Inline only for whitelisted safe MIME types; otherwise force a download so
    // an unexpected type can never render in-origin. (In practice every stored
    // type is allow-listed, so this only guards against future drift.)
    const requestedInline =
      new URL(request.url).searchParams.get("disposition") === "inline";
    const disposition: "inline" | "attachment" =
      requestedInline && isAllowedMimeType(doc.mimeType)
        ? "inline"
        : "attachment";

    const headers: Record<string, string> = {
      "Content-Type": doc.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": contentDisposition(disposition, doc.filename),
      // PII — never persist to any disk cache (private alone still allows it).
      "Cache-Control": "private, no-store",
    };
    if (disposition === "inline") {
      // Anti-framing hardening on the served response (R15): the document bytes
      // cannot be embedded by another origin.
      headers["Content-Security-Policy"] = "frame-ancestors 'self'";
    }

    // Zero-copy Uint8Array view over the Buffer's memory (matching offset/length)
    // rather than copying every byte into a second allocation per request.
    const body = new Uint8Array(
      doc.bytes.buffer as ArrayBuffer,
      doc.bytes.byteOffset,
      doc.bytes.byteLength,
    );
    return new Response(body, { headers });
  },
);
