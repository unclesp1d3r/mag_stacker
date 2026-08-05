import { namesByIds } from "@/src/auth/users";
import type { ServiceEventRow } from "./events-service";

/** Display label when `actorId` is `null` — the authoring account was later deleted. */
export const UNKNOWN_ACTOR_LABEL = "Unknown";

/**
 * One service-history row ready for display: a raw `ServiceEventRow` with its
 * `actorId` resolved to a display name (or `UNKNOWN_ACTOR_LABEL`). Structurally
 * identical to `ServiceHistoryEntry` (`app/(app)/firearms/service-history.tsx`)
 * — kept as a separate domain-owned type rather than importing that UI type
 * here, so this module (used by both the firearm and accessory detail pages)
 * has no dependency on the `app/` layer.
 */
export interface ServiceHistoryDisplayEntry {
  id: string;
  ruleName: string;
  servicedOn: string;
  actorName: string;
  notes: string;
}

/**
 * Attach each service-history event's actor display name (mirrors
 * `inventory-log/log-actions.ts`'s `listLogAction` — resolves `name`, not
 * `email`, since a view-grantee on a shared firearm can read this too).
 * Shared by the firearm and accessory detail pages so the same
 * `UNKNOWN_ACTOR_LABEL` and raw-id fallback policy can't drift between them.
 */
export async function withActorNames(
  events: ServiceEventRow[],
): Promise<ServiceHistoryDisplayEntry[]> {
  const actorIds = [
    ...new Set(
      events
        .map((event) => event.actorId)
        .filter((actorId): actorId is string => actorId !== null),
    ),
  ];
  const nameById = await namesByIds(actorIds);
  return events.map((event) => ({
    id: event.id,
    ruleName: event.ruleName,
    servicedOn: event.servicedOn,
    // A non-null `actorId` with no matching row (the account was deleted
    // between the event write and this read) falls back to
    // `UNKNOWN_ACTOR_LABEL` too, never the raw account id — leaking a raw id
    // into the UI is exactly what resolving a display name here exists to
    // avoid.
    actorName:
      event.actorId === null
        ? UNKNOWN_ACTOR_LABEL
        : (nameById.get(event.actorId) ?? UNKNOWN_ACTOR_LABEL),
    notes: event.notes,
  }));
}
