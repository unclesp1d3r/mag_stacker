import { desc, eq, inArray } from "drizzle-orm";
import { authorizeUpdate } from "@/src/auth/authorize";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import {
  type Permission,
  resolvePermission,
  visibleFirearmPermissions,
} from "@/src/auth/visibility";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import { type DbOrTx, db } from "@/src/db/client";
import { accessory, serviceEvent } from "@/src/db/schema";
import { ValidationError } from "../errors";
import { MAX_BULK_SERVICE_ITEMS } from "./constants";
import { resolveEffectiveRules } from "./derive";
import {
  loadDefaults,
  loadItemRules,
  requireAccessoryOwner,
  requireFirearmVisible,
  resolveParent,
  type ServiceParentType,
  toDefaultRule,
  toItemRule,
} from "./rules-service";
import {
  type ServiceEventInput,
  type ServiceEventUpdateInput,
  type ServiceEventValidationCode,
  validateServicedOn,
  validateServiceEventInput,
  validateServiceEventUpdateInput,
} from "./validate-event";

export type {
  ServiceEventInput,
  ServiceEventUpdateInput,
  ServiceEventValidationCode,
};

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

/**
 * Batched counterpart to `authorizeEventWrite`, used by the bulk mark-
 * serviced path (R16). Produces the EXACT SAME per-item authorization
 * outcome as calling `authorizeEventWrite` in a loop — same error type
 * (`NotAuthorizedError` for a firearm view-grantee, `NotFoundError` for
 * anything outside the actor's visible set, same as a stranger's item or a
 * non-owned accessory) — but in a bounded number of queries regardless of
 * batch size: one `visibleFirearmPermissions` call covers every firearm
 * pair, and one `IN` query covers every accessory pair, instead of one query
 * per item. `assertWritesAllowed` runs once up front rather than once per
 * item, which is safe: maintenance mode can't toggle mid-transaction.
 */
async function authorizeEventWritesBatch(
  tx: DbOrTx,
  actorId: string,
  items: BulkServiceItem[],
): Promise<void> {
  await assertWritesAllowed(tx);

  const firearmIds = [
    ...new Set(
      items
        .filter((item) => item.parentType === "firearm")
        .map((item) => item.parentId),
    ),
  ];
  const accessoryIds = [
    ...new Set(
      items
        .filter((item) => item.parentType === "accessory")
        .map((item) => item.parentId),
    ),
  ];

  const firearmPermissions: Map<string, Permission> =
    firearmIds.length > 0
      ? await visibleFirearmPermissions(tx, actorId)
      : new Map();

  const accessoryOwners = new Map<string, string>();
  if (accessoryIds.length > 0) {
    const rows = await tx
      .select({ id: accessory.id, ownerId: accessory.ownerId })
      .from(accessory)
      .where(inArray(accessory.id, accessoryIds));
    for (const row of rows) accessoryOwners.set(row.id, row.ownerId);
  }

  for (const item of items) {
    if (item.parentType === "firearm") {
      const perm = firearmPermissions.get(item.parentId) ?? null;
      if (perm === "owner" || perm === "edit") continue;
      if (perm === "view") {
        throw new NotAuthorizedError(
          "read-only access; cannot modify this item",
        );
      }
      throw new NotFoundError();
    } else {
      const ownerId = accessoryOwners.get(item.parentId);
      if (ownerId === undefined || ownerId !== actorId) {
        throw new NotFoundError();
      }
    }
  }
}

function parentColumns(parentType: ServiceParentType, parentId: string) {
  return {
    firearmId: parentType === "firearm" ? parentId : null,
    accessoryId: parentType === "accessory" ? parentId : null,
  };
}

/**
 * An item's current effective rule names — its own item rules plus its
 * owner's category defaults for the item's category (R4, R5), reusing
 * `rules-service.ts`'s single-item resolution helpers and `derive.ts`'s
 * `resolveEffectiveRules` (DRY, mirroring `due-service.ts`'s per-item shape).
 * Backs the F2 fix below: a `ruleName` a caller submits is only ever
 * trustworthy when it is re-checked against what the item actually carries
 * NOW, not what it carried when a form rendered.
 *
 * Queries here run SEQUENTIALLY, not via `Promise.all` — `tx` is a single
 * connection bound to one open transaction, so issuing two queries against
 * it concurrently races on that one connection (node-postgres deprecates
 * this: "Calling client.query() when the client is already executing a
 * query"). `due-service.ts`'s batched loaders can run concurrently because
 * each one there queries the pool-level `db`, which hands out a separate
 * connection per call; that shape doesn't apply inside a transaction.
 */
async function loadEffectiveRuleNames(
  tx: DbOrTx,
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
): Promise<Set<string>> {
  const { ownerId, category } =
    parentType === "firearm"
      ? await requireFirearmVisible(tx, actorId, parentId)
      : await requireAccessoryOwner(tx, actorId, parentId);
  const defaultRows = await loadDefaults(tx, ownerId, parentType, category);
  const itemRuleRows = await loadItemRules(tx, parentType, parentId);
  const resolved = resolveEffectiveRules(
    defaultRows.map(toDefaultRule),
    itemRuleRows.map(toItemRule),
  );
  return new Set(resolved.map((rule) => rule.name));
}

/**
 * Confirm `ruleName` resolves against `parentId`'s current effective rule
 * set (F2 fix). The `/summary` bulk checklist captures `ruleName` at render
 * time; if the rule was renamed on this item between render and submit, the
 * old name no longer resolves, and inserting a `service_event` under it
 * anyway would land under a dead name — `loadLastServicePointBatch` groups
 * strictly by exact name, so due state would silently never advance and the
 * owner would get no error at all. Rejecting here, inside the same
 * transaction as the write, closes that window.
 */
async function assertRuleExists(
  tx: DbOrTx,
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
  ruleName: string,
): Promise<void> {
  const names = await loadEffectiveRuleNames(tx, actorId, parentType, parentId);
  if (!names.has(ruleName)) {
    throw new ValidationError(["ruleNotFound"]);
  }
}

/**
 * Batched counterpart to `assertRuleExists`, for the bulk path. Resolves
 * effective rule names ONCE PER UNIQUE (parentType, parentId) pair in the
 * batch, not once per item — a duplicate item+rule pair (F8) or several rows
 * against the same item costs one lookup, not several. `MAX_BULK_SERVICE_ITEMS`
 * (F6) bounds the batch to a few hundred, so this per-unique-item shape is
 * proportionate here; it is not `due-service.ts`'s fully batched,
 * one-query-per-data-source shape, which exists for the much larger
 * visible-collection READ path (KTD4).
 *
 * Lookups run SEQUENTIALLY (a `for...of` with `await`, not `Promise.all`) —
 * see `loadEffectiveRuleNames`'s doc: `tx` is one connection, and this whole
 * batch shares it.
 */
async function assertRuleNamesResolveBulk(
  tx: DbOrTx,
  actorId: string,
  items: BulkServiceItem[],
): Promise<void> {
  const uniqueParents = new Map<
    string,
    { parentType: ServiceParentType; parentId: string }
  >();
  for (const item of items) {
    uniqueParents.set(`${item.parentType}:${item.parentId}`, item);
  }

  const namesByParent = new Map<string, Set<string>>();
  for (const [key, { parentType, parentId }] of uniqueParents) {
    namesByParent.set(
      key,
      await loadEffectiveRuleNames(tx, actorId, parentType, parentId),
    );
  }

  for (const item of items) {
    const key = `${item.parentType}:${item.parentId}`;
    const names = namesByParent.get(key);
    if (!names?.has(item.ruleName.trim())) {
      throw new ValidationError(["ruleNotFound"]);
    }
  }
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
    await assertRuleExists(tx, actorId, parentType, parentId, ruleName);
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
 * touching the database. Rejects a batch over `MAX_BULK_SERVICE_ITEMS` (F6)
 * before any DB work at all, and rejects any pair whose `ruleName` no longer
 * resolves against that item's current effective rule set (F2) inside the
 * same transaction as the writes.
 */
export async function logServiceEventsBulk(
  actorId: string,
  input: BulkServiceInput,
): Promise<ServiceEventRow[]> {
  const { items, notes = "" } = input;
  if (items.length === 0) return [];
  if (items.length > MAX_BULK_SERVICE_ITEMS) {
    throw new ValidationError(["bulkTooLarge"]);
  }

  const servicedOn = input.servicedOn.trim();
  const codes: ServiceEventValidationCode[] = [
    ...validateServicedOn(servicedOn),
  ];
  if (items.some((item) => item.ruleName.trim() === "")) {
    codes.push("emptyRuleName");
  }
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    await authorizeEventWritesBatch(tx, actorId, items);
    await assertRuleNamesResolveBulk(tx, actorId, items);
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
 * Resolve which parent family and id a `service_event` row belongs to,
 * straight off the row itself — `service_event`'s exactly-one-parent CHECK
 * (KTD2) guarantees exactly one of these is non-null for a real row.
 * Exported so `service-actions.ts` can revalidate the correct detail route
 * after an edit or delete using only the row the domain layer handed back,
 * never a parent the client would otherwise have to supply and be trusted.
 */
export function resolveServiceEventParent(
  row: Pick<ServiceEventRow, "firearmId" | "accessoryId">,
): { parentType: ServiceParentType; parentId: string } {
  const parent = resolveParent(row);
  if (parent !== null) return parent;
  // Defensive only — the DB's exactly-one-parent CHECK guarantees a real row
  // never reaches here. Not found is the safest response to an impossible
  // row shape: it reveals nothing and matches every other "can't resolve
  // this event" outcome in this file.
  throw new NotFoundError();
}

/**
 * Correct an existing service event's `servicedOn` and/or `notes` — the
 * correction path this unit adds. Before this, `events-service.ts` exported
 * only `logServiceEvent`/`logServiceEventsBulk`/`listServiceHistory`: once an
 * event was written, a mis-logged date had no in-app fix, and because due
 * state is `MAX(serviced_on)` grouped by (item, rule_name) with nothing else
 * stored (KD5), that one bad row silently skewed the rule's due state
 * forever.
 *
 * `ruleName` and the parent are deliberately NOT accepted here — only
 * `ServicedOn`/`notes` may change (see `ServiceEventUpdateInput`'s doc).
 * Letting an edit move an event to a different rule or a different item
 * would let one write silently rewrite TWO rules' derived due state at once
 * (the old rule loses an entry from its `MAX`, the new one gains one) with
 * no signal that either happened. Renaming a rule (`updateItemRule` in
 * `rules-service.ts`, which re-points its events in the same transaction,
 * KTD1) and re-logging a fresh event under the correct rule are the
 * supported paths for those cases.
 *
 * The parent is resolved from the ROW ITSELF (`resolveServiceEventParent`),
 * never from a caller-supplied value — an event id is the only trustworthy
 * handle a caller has on an existing event. Authorization is the EXACT SAME
 * per-family check `logServiceEvent` uses (`authorizeEventWrite`, KTD3): an
 * edit-grantee may correct an event on a shared firearm; accessories are
 * owner-only throughout. An event outside the actor's visible set raises
 * `NotFoundError`, never a permission error — the same "not-owner and
 * not-found are indistinguishable" shape every accessory path in this file
 * already follows.
 */
export async function updateServiceEvent(
  actorId: string,
  eventId: string,
  input: ServiceEventUpdateInput,
): Promise<ServiceEventRow> {
  const codes = validateServiceEventUpdateInput(input);
  if (codes.length > 0) throw new ValidationError(codes);
  const servicedOn = input.servicedOn.trim();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.id, eventId))
      .limit(1);
    if (!existing) throw new NotFoundError();

    const { parentType, parentId } = resolveServiceEventParent(existing);
    await authorizeEventWrite(tx, actorId, parentType, parentId);

    const [row] = await tx
      .update(serviceEvent)
      .set({ servicedOn, notes: input.notes ?? "" })
      .where(eq(serviceEvent.id, eventId))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

/**
 * Delete a service event outright — the other half of the correction path.
 * Because due state is derived on read from `MAX(serviced_on)` per (item,
 * rule_name) with nothing stored (KD5), deleting the newest event for a rule
 * needs no special-case handling here at all: the very next read
 * (`due-service.ts`'s `loadLastServicePointBatch`, a grouped `max` over
 * whatever rows remain) simply finds the next-newest remaining event for
 * that name, or finds none and falls back to the item's origin date (R10).
 * Nothing is recomputed or cascaded by this function — that is the entire
 * point of nothing being stored.
 *
 * Same authorization and parent-resolution shape as `updateServiceEvent`:
 * the parent is read off the row, never supplied by the caller, and
 * `authorizeEventWrite` enforces the same per-family split `logServiceEvent`
 * uses. Returns the now-deleted row (not `void`) so a caller that only ever
 * had an `eventId` to begin with — `service-actions.ts`'s delete action —
 * can still learn which detail route to revalidate via
 * `resolveServiceEventParent`, without the client supplying (and this layer
 * having to trust) a parent of its own.
 */
export async function deleteServiceEvent(
  actorId: string,
  eventId: string,
): Promise<ServiceEventRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.id, eventId))
      .limit(1);
    if (!existing) throw new NotFoundError();

    const { parentType, parentId } = resolveServiceEventParent(existing);
    await authorizeEventWrite(tx, actorId, parentType, parentId);

    await tx.delete(serviceEvent).where(eq(serviceEvent.id, eventId));
    return existing;
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
