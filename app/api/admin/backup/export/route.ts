import { Readable } from "node:stream";
import { getCurrentUser } from "@/src/auth/session";
import { recordOperatorEvent } from "@/src/backup/audit";
import { createBackup } from "@/src/backup/export-service";
import { db } from "@/src/db/client";

/**
 * Admin backup export (plan Unit U6, R1/R14/R15).
 *
 * `POST` with either a JSON body `{ "password": string }` or a
 * `application/x-www-form-urlencoded` body (`password=...`) — the latter is
 * what U7's export UI actually sends: a real `<form method="POST"
 * action="/api/admin/backup/export">` submit, so the browser performs a
 * genuine navigation-triggered download instead of a client-side `fetch()` +
 * blob (which would re-buffer a GB-scale bundle in the browser and undercut
 * R13). Either way the request side is small (just a password), so it's read
 * fully (`request.json()` / `request.formData()`) rather than streamed;
 * R13's streaming guarantee is about the response, which IS streamed
 * straight through from U4's `createBackup()` (a Node `Readable`, bridged to
 * the Web `ReadableStream` `Response` expects via `Readable.toWeb`) with no
 * buffering and nothing written server-side (KTD8).
 *
 * Gating mirrors `app/(admin)/users/actions.ts`'s inline `requireAdmin()`
 * convention (KTD6): an unauthenticated caller gets 401, an authenticated
 * non-admin gets 403 — both with no body, since there's no per-resource
 * existence to hide here (unlike `app/api/documents/[id]/route.ts`'s 404
 * collapse), only a whole admin feature to gate.
 *
 * Every attempt that reaches the admin gate is recorded to `operator_audit`
 * (R15), success or failure. "Success" is recorded once the encrypted
 * stream has been composed and handed to the platform for delivery — the
 * finest-grained signal available; neither the Node `Readable`/Web
 * `ReadableStream` APIs nor U4 itself expose "the browser received every
 * byte".
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (user.role !== "admin") return new Response(null, { status: 403 });

  let password: string;
  try {
    password = await readPassword(request);
  } catch (error) {
    await recordOperatorEvent({
      actor: user.email,
      action: "export",
      outcome: `failure: ${errorMessage(error)}`,
    }).catch(() => {});
    return Response.json(
      { error: "a non-empty password is required" },
      { status: 400 },
    );
  }

  let bundle: Readable;
  try {
    bundle = await createBackup(password, { db });
  } catch (error) {
    await recordOperatorEvent({
      actor: user.email,
      action: "export",
      outcome: `failure: ${errorMessage(error)}`,
    }).catch(() => {});
    return Response.json({ error: "backup export failed" }, { status: 500 });
  }

  await recordOperatorEvent({
    actor: user.email,
    action: "export",
    outcome: "success",
  });

  const filename = `magstacker-backup-${timestampForFilename()}.magstacker-backup`;
  return new Response(Readable.toWeb(bundle) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Bytes decrypt to the whole instance — never cache on disk (mirrors
      // the documents route's same PII posture).
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Reads the password from either an `application/x-www-form-urlencoded` body
 * (the real `<form>` submit U7's export UI sends) or a JSON body (the
 * original contract, still supported so existing callers/tests keep
 * working). `Request.formData()` parses both `multipart/form-data` and
 * `application/x-www-form-urlencoded` per the Fetch spec, so form-encoded
 * bodies are routed there; anything else falls back to `request.json()`.
 */
async function readPassword(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  const password = contentType.includes("application/x-www-form-urlencoded")
    ? (await request.formData()).get("password")
    : ((await request.json()) as { password?: unknown }).password;

  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password is required");
  }
  return password;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `YYYY-MM-DDTHH-MM-SS-mmmZ`, filesystem-safe (no `:`). */
function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
