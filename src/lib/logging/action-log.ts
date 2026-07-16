import type pino from "pino";
import { getContext } from "./context";
import { childLogger } from "./logger";

/**
 * Typed action-log helper (R20). Emits a human-readable `info` line naming
 * the actor and object for create/delete of primary domain objects
 * (firearms, magazines — A5), plus structured, redaction-safe fields. The
 * actor is read from the ambient ALS context (seeded by `withActionContext`,
 * KTD-4), so call sites never thread the session through service signatures;
 * the correlation id is picked up automatically via the logger's `mixin()`.
 *
 * The message string is built ONLY from known-safe inputs (verb, actor
 * display name/id, object type, a length-bounded object label) — never a
 * sensitive field like a serial number (R9, R18).
 */

/** Message-string label length bound (R20) — longer labels are truncated for the message. */
export const ACTION_LABEL_MAX = 64;

export type ActionVerb = "created" | "deleted";
export type ActionObjectType = "firearm" | "magazine";

export interface ActionLogInput {
  verb: ActionVerb;
  objectType: ActionObjectType;
  objectLabel: string;
}

function truncateLabel(label: string, max: number): string {
  return label.length > max ? label.slice(0, max) : label;
}

/**
 * Emit an action-log line. `log` defaults to a `childLogger` scoped to
 * `objectType` (module) — call sites use the 1-arg form. The optional second
 * parameter exists so tests can inject a logger built against an in-memory
 * capture stream (mirrors `logger.test.ts`'s pattern) instead of the real
 * lazy singleton, which spawns worker-thread transports.
 */
export function logAction(
  input: ActionLogInput,
  log: pino.Logger = childLogger(input.objectType),
): void {
  const ctx = getContext();
  const actorName = ctx?.actorName;
  const actorId = ctx?.actorId;
  const actor = actorName ?? actorId ?? "unknown";
  const truncatedLabel = truncateLabel(input.objectLabel, ACTION_LABEL_MAX);
  const message = `${actor} ${input.verb} ${input.objectType} "${truncatedLabel}"`;

  log.info(
    {
      action: {
        verb: input.verb,
        actor: actorName,
        actorId,
        objectType: input.objectType,
        objectLabel: truncatedLabel,
      },
    },
    message,
  );
}
