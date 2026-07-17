import { getCurrentUser, type SessionUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import { mintCorrelationId, runWithContext } from "@/src/lib/logging";

/**
 * The display name to seed as `actorName`. Better Auth defaults `name` to the
 * account's email when no display name is given (see
 * `app/(admin)/users/actions.ts` + `scripts/seed-admin.ts`), so `user.name` can
 * BE an email. `actorName` is emitted as a structured field AND interpolated
 * into action-log messages — neither of which is covered by the key-based email
 * redaction — so an email-shaped name would leak (violating R8/R18). Drop it in
 * that case: `logAction`/the mixin then fall back to `actorId` (a safe UUID).
 */
function safeActorName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  return name.includes("@") ? undefined : name;
}

/**
 * Single entry-point wrapper for `"use server"` actions (R10, R19, KTD-4).
 * Resolves the session, mints a correlation id, seeds the ALS context with
 * the fields known at entry (`correlationId`, `entrypoint`, actor id + display
 * name), runs `handler`, and funnels any thrown error through the shared
 * `toActionError` chokepoint (KTD-7). This *replaces* the previous per-file
 * `requireUserId()` + `try/catch/toActionError` boilerplate.
 *
 * `ownerId` is deliberately NOT seeded here — `getCurrentUser()` exposes no
 * owner id, and the true owner is only resolved inside the service
 * transaction (see plan KTD-4). Callers that have resolved an owner attach
 * it as a per-line field at that point instead.
 */
export async function withActionContext<T>(
  entrypoint: string,
  handler: (userId: string) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const correlationId = mintCorrelationId();
  // Establish the base context (correlation id + entrypoint) BEFORE resolving
  // the session, and resolve the user INSIDE the guarded try. A session/DB
  // failure in getCurrentUser() then still returns a non-leaking ActionResult
  // AND is logged with correlation context, instead of rejecting the action.
  return runWithContext({ correlationId, entrypoint }, async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return toActionError(new Error("Unauthenticated"));
      // Re-establish context with the resolved actor for the handler scope.
      return await runWithContext(
        {
          correlationId,
          entrypoint,
          actorId: user.id,
          actorName: safeActorName(user.name),
        },
        () => handler(user.id),
      );
    } catch (error) {
      return toActionError(error);
    }
  });
}

/**
 * Entry-point wrapper for the admin surface (`app/(admin)/users/actions.ts`).
 * Unlike `withActionContext`, this does not itself assert admin or funnel
 * errors through `toActionError` — the admin actions keep their existing
 * `requireAdmin()` / `assertWritesAllowed(db)` gates and bespoke error
 * mapping (their local `ActionResult` shape predates and differs from the
 * domain `ActionResult<T>`). This wrapper's only job is to resolve the
 * session once and seed the ALS context so admin-action log lines carry a
 * correlation id and the acting user, when one is resolved.
 */
export async function withAdminActionContext<T>(
  entrypoint: string,
  handler: (user: SessionUser | null) => Promise<T>,
): Promise<T> {
  const correlationId = mintCorrelationId();
  // Base context first (so even a session failure logs with correlation),
  // then resolve the user and re-establish context with the actor. This
  // wrapper deliberately does NOT catch — admin actions keep their own error
  // mapping (see doc above).
  return runWithContext({ correlationId, entrypoint }, async () => {
    const user = await getCurrentUser();
    return runWithContext(
      {
        correlationId,
        entrypoint,
        actorId: user?.id,
        actorName: safeActorName(user?.name),
      },
      () => handler(user),
    );
  });
}

/**
 * Entry-point wrapper for `Request → Response` route handlers. Mints a
 * correlation id — honoring an inbound `x-request-id` header when present,
 * so a caller-supplied trace id survives — and runs `handler(...args)` inside
 * that context. Does not resolve a user: route handlers vary widely in
 * whether/how they authenticate.
 *
 * Forwards ALL arguments (not just `req`) so it works for Next.js's
 * dynamic-segment route handlers, whose second parameter carries
 * `{ params: Promise<...> }` — `(req, ctx) => Promise<Response>` — as well as
 * plain `(req) => Promise<Response>` handlers.
 *
 * The generic is bounded to `[Request, ...unknown[]]` so the first argument is
 * guaranteed to be the `Request` — Next.js always invokes route handlers with
 * one — which keeps the inbound-`x-request-id` read sound without a cast. A
 * handler that ignores the request must still declare it (`(_req) => ...`).
 *
 * An inbound `x-request-id` is only honored when it matches a safe opaque
 * shape (`SAFE_REQUEST_ID`). The header is client-controllable if a proxy
 * doesn't strip it, so accepting it verbatim would let a caller inject PII
 * (an email, a serial) as the `correlationId`, which lands in logs unredacted
 * (key-based redaction doesn't cover it). Anything else mints a fresh UUID.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function withRequestContext<A extends [Request, ...unknown[]]>(
  entrypoint: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return (...args: A) => {
    const [req] = args;
    const inbound = req.headers.get("x-request-id")?.trim();
    const correlationId =
      inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : mintCorrelationId();
    return runWithContext({ correlationId, entrypoint }, () =>
      handler(...args),
    );
  };
}
