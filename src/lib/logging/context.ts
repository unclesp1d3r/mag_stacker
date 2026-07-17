import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Request/action-scoped fields threaded implicitly via AsyncLocalStorage
 * (R10). Every log line emitted within a `runWithContext` callback picks
 * these up automatically through the logger's `mixin()` (see `logger.ts`).
 */
export interface LogContext {
  correlationId: string;
  /**
   * The entry point that started this unit of work — the server action group,
   * route, boot hook, or CLI (e.g. `"firearms"`, `"backup-export"`). Emitted
   * under the `entrypoint` key, deliberately distinct from a `childLogger`'s
   * `module` binding (the specific code area emitting a given line) so the two
   * never collide on one JSON key.
   */
  entrypoint?: string;
  actorId?: string;
  actorName?: string;
  /**
   * NOTE: there is deliberately no `ownerId` here. The true owner of a write is
   * resolved only inside the service transaction (create-on-behalf / grants
   * make `actorId !== ownerId` a real case), and one ALS scope can span
   * operations against different owners — so an ambient `ownerId` would
   * misattribute lines (KTD-4). Attach `ownerId` as a per-line field on the
   * individual log call where it has actually been resolved.
   */
}

/** The single ALS store for the whole app's request/action context. */
export const logContext = new AsyncLocalStorage<LogContext>();

/** Run `fn` with `ctx` established as the ambient log context (R10). */
export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return logContext.run(ctx, fn);
}

/** The ambient log context, or `undefined` outside any `runWithContext`. */
export function getContext(): LogContext | undefined {
  return logContext.getStore();
}

/** Mint a fresh correlation id (R11) — used by entry points with no ambient request context. */
export function mintCorrelationId(): string {
  return randomUUID();
}
