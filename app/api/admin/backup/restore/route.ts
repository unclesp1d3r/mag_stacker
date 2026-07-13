import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { getCurrentUser } from "@/src/auth/session";
import { recordOperatorEvent } from "@/src/backup/audit";
import { type RestoreOutcome, restore } from "@/src/backup/restore-service";
import { sameOriginError } from "@/src/backup/same-origin";

/**
 * Admin backup restore (plan Unit U6, R5/R14/R15).
 *
 * The upload can be GB-scale (R13), so this is a genuinely streamed Route
 * Handler on BOTH sides: `request.body` (a Web `ReadableStream`) is bridged
 * to a Node `Readable` via `Readable.fromWeb` and handed straight to U5's
 * `restore()` — never buffered, never routed through a `"use server"`
 * Server Action (whose body size cap this therefore bypasses, per plan).
 *
 * Request contract (documented, deliberately simple — not multipart, so no
 * streaming multipart parser is needed to keep the body unbuffered):
 * - `X-Backup-Password` header — required, the bundle's password.
 * - `X-Backup-Force` header — optional, `"true"` to force-replace a
 *   non-empty instance (R7); anything else (including absent) means the
 *   safe refuse-unless-empty default (R6).
 * - The raw encrypted bundle bytes as the request body
 *   (`Content-Type: application/octet-stream`).
 *
 * Metadata travels in headers rather than a query string so the password
 * never lands in a URL (server access logs, browser history, proxies).
 *
 * Gating mirrors the export route: 401 unauthenticated, 403 non-admin, both
 * with no body (KTD6), followed immediately by `sameOriginError`
 * (`src/backup/same-origin.ts`, hardening pass) refusing a cross-origin POST
 * with a bodyless 403 — this route is a plain Route Handler, never routed
 * through Better Auth's own handler, so Better Auth's origin checks never
 * apply to it. The response is a discriminated JSON outcome the UI
 * can branch on (R6/R7/R8/R9/AE1-AE4): `{ outcome, message }`, `outcome`
 * mirroring U5's `RestoreOutcome["kind"]` one-for-one, mapped to the HTTP
 * status below. Every attempt that reaches the admin gate is recorded to
 * `operator_audit` (R15), success or failure.
 */
const OUTCOME_STATUS: Record<RestoreOutcome["kind"], number> = {
  ok: 200,
  refused_not_empty: 409,
  wrong_password_or_tampered: 400,
  version_mismatch: 409,
  rolled_back: 500,
};

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (user.role !== "admin") return new Response(null, { status: 403 });

  const originError = sameOriginError(request);
  if (originError) return originError;

  const password = request.headers.get("x-backup-password");
  if (!password) {
    return Response.json(
      { outcome: "bad_request", message: "a password is required" },
      { status: 400 },
    );
  }
  if (!request.body) {
    return Response.json(
      { outcome: "bad_request", message: "a backup bundle body is required" },
      { status: 400 },
    );
  }
  const force = request.headers.get("x-backup-force") === "true";
  const bundleStream = toNodeReadable(request.body);

  let outcome: RestoreOutcome;
  try {
    outcome = await restore(bundleStream, password, { force });
  } catch (error) {
    await recordOperatorEvent({
      actor: user.email,
      action: "restore",
      outcome: `failure: ${errorMessage(error)}`,
    }).catch(() => {});
    return Response.json(
      { outcome: "error", message: "restore failed unexpectedly" },
      { status: 500 },
    );
  }

  await recordOperatorEvent({
    actor: user.email,
    action: "restore",
    outcome: outcome.kind,
  });

  return Response.json(
    { outcome: outcome.kind, message: outcome.message },
    { status: OUTCOME_STATUS[outcome.kind] },
  );
}

/** Bridges the Web `ReadableStream` `request.body` is typed as (the DOM lib
 * global) into the Node `Readable` `restore()` (U5) expects. The runtime
 * shapes are compatible (Node's fetch implementation IS a Web stream); only
 * the two ambient type declarations (DOM's `lib.dom.d.ts` vs. `node:stream/web`)
 * disagree, hence the cast. */
function toNodeReadable(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
