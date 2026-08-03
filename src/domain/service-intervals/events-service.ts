import { desc, eq } from "drizzle-orm";
import { authorizeUpdate } from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { resolvePermission } from "@/src/auth/visibility";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import { type DbOrTx, db } from "@/src/db/client";
import { accessory, serviceEvent } from "@/src/db/schema";
import { ValidationError } from "../errors";
import type { ServiceParentType } from "./rules-service";
import {
  type ServiceEventInput,
  type ServiceEventValidationCode,
  validateServicedOn,
  validateServiceEventInput,
} from "./validate-event";

export type { ServiceEventInput, ServiceEventValidationCode };

/**
 * Service-events layer (service-intervals plan, U4). Logging one event, the
 * R16 bulk mark-serviced path, and service history reads. Nothing here
 * decides due state (that's `due-service.ts`) — this file only ever writes
 * and reads `service_event` rows.
 *
 * Authorization mirrors `rules-service.ts`'s split (KTD3), but for WRITES
 * only, and deliberately looser on firearms than rule configuration: logging
 * a firearm service event takes `authorizeUpdate` (an edit-grantee may log
 * service — this is exactly what the now-retired `cleaned`/`lubed` inventory
 * log entries permitted via `authorizeUpdate` in `inventory-log/service.ts`,
 * so U5's conversion preserved capability an edit-grantee already had rather
 * than silently revoking it). Accessory
 * events are owner-only throughout (accessories have no `authorize.ts` gate
 * and are never a grant `ParentType`). `actorId` is always the parameter the
 * caller authorized with — never a separate, caller-suppliable field on the
 * input — so an event can never be logged in anyone's name but the actor's.
 *
 * The bulk path (R16) is a convenience over the single path, not a
 * higher-privilege one: it authorizes every item in the batch with the exact
 * same per-family rule as `logServiceEvent`, inside one transaction, so a
 * single unauthorized pair rolls the whole batch back and writes nothing.
 */

export type ServiceEventRow = typeof serviceEvent.$inferSelect;

/**
 * Authorize an event WRITE for one item, per family (KTD3): firearms accept
 * an edit grant (`authorizeUpdate`); accessories are owner-only, resolved
 * directly since they have no `authorize.ts` gate and never route through
 * the mounted-firearm visibility inheritance (that inheritance is for
 * viewing/using the accessory, not for configuring or logging service
 * against it).
 */
async function authorizeEventWrite(
  tx: DbOrTx,
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
): Promise<void> {
  if (parentType === "firearm") {
    await authorizeUpdate(tx, actorId, "firearm", parentId);
    return;
  }
  await assertWritesAllowed(tx);
  const [row] = await tx
    .select({ ownerId: accessory.ownerId })
    .from(accessory)
    .where(eq(accessory.id, parentId))
    .limit(1);
  if (!row || row.ownerId !== actorId) throw new NotFoundError();
}

function parentColumns(parentType: ServiceParentType, parentId: string) {
  return {
    firearmId: parentType === "firearm" ? parentId : null,
    accessoryId: parentType === "accessory" ? parentId : null,
  };
}

/**
 * Log one service event against a rule (R14). `actorId` is always the
 * acting user (never caller-supplied) and is authorized before any write.
 */
export async function logServiceEvent(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
  input: ServiceEventInput,
): Promise<ServiceEventRow> {
  const codes = validateServiceEventInput(input);
  if (codes.length > 0) throw new ValidationError(codes);

  const ruleName = input.ruleName.trim();
  const servicedOn = input.servicedOn.trim();

  return db.transaction(async (tx) => {
    await authorizeEventWrite(tx, actorId, parentType, parentId);
    const [row] = await tx
      .insert(serviceEvent)
      .values({
        ...parentColumns(parentType, parentId),
        ruleName,
        servicedOn,
        actorId,
        notes: input.notes ?? "",
      })
      .returning();
    return row;
  });
}

/** One item-and-rule pair to mark serviced in a bulk call (R16). */
export interface BulkServiceItem {
  parentType: ServiceParentType;
  parentId: string;
  ruleName: string;
}

export interface BulkServiceInput {
  items: BulkServiceItem[];
  servicedOn: string;
  notes?: string;
}

/**
 * Mark one or many item-and-rule pairs serviced as of one date, in a single
 * transaction (R16). Authorizes every pair with the same per-family rule
 * `logServiceEvent` uses; any single unauthorized (or missing) pair throws
 * and rolls the whole batch back, so the batch either writes every event or
 * writes none. An empty `items` list writes nothing and returns `[]` without
 * touching the database.
 */
export async function logServiceEventsBulk(
  actorId: string,
  input: BulkServiceInput,
): Promise<ServiceEventRow[]> {
  const { items, notes = "" } = input;
  if (items.length === 0) return [];

  const servicedOn = input.servicedOn.trim();
  const codes: ServiceEventValidationCode[] = [
    ...validateServicedOn(servicedOn),
  ];
  if (items.some((item) => item.ruleName.trim() === "")) {
    codes.push("emptyRuleName");
  }
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    for (const item of items) {
      await authorizeEventWrite(tx, actorId, item.parentType, item.parentId);
    }
    return tx
      .insert(serviceEvent)
      .values(
        items.map((item) => ({
          ...parentColumns(item.parentType, item.parentId),
          ruleName: item.ruleName.trim(),
          servicedOn,
          actorId,
          notes,
        })),
      )
      .returning();
  });
}

/**
 * Assert visibility (firearm, any permission) or ownership (accessory,
 * KTD3) so history reads never reveal existence of an unseen item.
 */
async function assertHistoryReadable(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
): Promise<void> {
  if (parentType === "firearm") {
    const perm = await resolvePermission(db, actorId, "firearm", parentId);
    if (perm === null) throw new NotFoundError();
    return;
  }
  const [row] = await db
    .select({ ownerId: accessory.ownerId })
    .from(accessory)
    .where(eq(accessory.id, parentId))
    .limit(1);
  if (!row || row.ownerId !== actorId) throw new NotFoundError();
}

/**
 * An item's service history, newest first (R17): ordered by `serviced_on`
 * desc, then `created_at` desc so several rules logged on one day still
 * sort in a stable order. A firearm's history is readable by any
 * visibility level (owner/edit/view, KTD3); an accessory's is owner-only.
 */
export async function listServiceHistory(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
): Promise<ServiceEventRow[]> {
  await assertHistoryReadable(actorId, parentType, parentId);

  const parentWhere =
    parentType === "firearm"
      ? eq(serviceEvent.firearmId, parentId)
      : eq(serviceEvent.accessoryId, parentId);

  return db
    .select()
    .from(serviceEvent)
    .where(parentWhere)
    .orderBy(desc(serviceEvent.servicedOn), desc(serviceEvent.createdAt));
}
