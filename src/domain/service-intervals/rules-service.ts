import { and, asc, count, eq } from "drizzle-orm";
import { authorizeOwnerOnlyUpdate } from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { resolvePermission } from "@/src/auth/visibility";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import { type DbOrTx, db } from "@/src/db/client";
import {
  accessory,
  firearm,
  serviceEvent,
  serviceRule,
  serviceRuleDefault,
} from "@/src/db/schema";
import { ValidationError } from "../errors";
import type { DefaultRule, ItemRule } from "./derive";
import { validateServiceRuleSet } from "./validate";

/**
 * Defaults and item-rule service layer (service-intervals plan, U3). Owns
 * category-default CRUD, per-item rule CRUD (override/suppress/item-only,
 * R5), and the owner's distinct accessory-category listing (KTD8).
 *
 * Authorization splits by parent family (KTD3):
 * - Defaults are owner-scoped with no grant path at all — every read and
 *   write filters on `owner_id = actorId` directly; there is no visibility
 *   layer to route through.
 * - A firearm's item-rule WRITES require `authorizeOwnerOnlyUpdate` — an
 *   edit-grantee may log service (U4) but may not configure what the owner is
 *   prompted about. Firearm item-rule READS resolve through the firearm's own
 *   visibility (`resolvePermission`) so a view-grantee can see a shared
 *   firearm's resolved rules, `NotFoundError` for an unseen firearm so
 *   existence is never revealed.
 * - Accessories have no `authorize.ts` gate at all (not a grant
 *   `ParentType`). Every accessory read and write here checks
 *   `accessory.ownerId === actorId` directly and NEVER calls
 *   `resolveAccessoryPermission` — that function inherits permission from the
 *   mounted firearm, which would hand a firearm grantee configuration KTD3
 *   reserves to the accessory's own owner. Not-owner and not-found are
 *   deliberately indistinguishable here (`NotFoundError` either way).
 *
 * Renaming an item rule re-points that item's `service_event` rows carrying
 * the old `rule_name` in the same transaction (KTD1's trade-off), and a
 * rename onto a name the item already uses is rejected with the existing
 * duplicate-name `ValidationError` BEFORE any write, so the DB's unique
 * constraint is never what surfaces the error.
 */

export type ServiceParentType = "firearm" | "accessory";
/** A default set's scope uses the same two values as an item's parent family. */
export type ServiceScope = ServiceParentType;

export type ServiceRuleDefaultRow = typeof serviceRuleDefault.$inferSelect;
export type ServiceRuleRow = typeof serviceRule.$inferSelect;

export interface ServiceRuleDefaultInput {
  scope: ServiceScope;
  category: string;
  name: string;
  intervalDays?: number | null;
  intervalSessions?: number | null;
  intervalRounds?: number | null;
}

export type ServiceRuleDefaultUpdateInput = Omit<
  ServiceRuleDefaultInput,
  "scope" | "category"
>;

export interface ItemRuleInput {
  name: string;
  suppressed?: boolean;
  intervalDays?: number | null;
  intervalSessions?: number | null;
  intervalRounds?: number | null;
}

// ---- row <-> pure-domain-shape mapping (U2's `derive.ts` types) ----
// Exported so U4's `due-service.ts` maps rows the same way rather than
// re-deriving this shape a second time (DRY).

export function toDefaultRule(row: ServiceRuleDefaultRow): DefaultRule {
  return {
    name: row.name,
    intervalDays: row.intervalDays,
    intervalSessions: row.intervalSessions,
    intervalRounds: row.intervalRounds,
  };
}

export function toItemRule(row: ServiceRuleRow): ItemRule {
  return {
    name: row.name,
    suppressed: row.suppressed,
    intervalDays: row.intervalDays,
    intervalSessions: row.intervalSessions,
    intervalRounds: row.intervalRounds,
  };
}

// ---- shared loaders ----
// `loadDefaults` and `loadItemRules` are exported for reuse by U4's
// `due-service.ts`, whose per-item due lookup needs exactly the same
// owner+scope+category / parent-scoped queries this file already defines
// (DRY) — the batched, collection-wide loaders due-service also needs are
// new (KTD4: bounded query count over the whole visible set), so only the
// single-item shape is shared here.

export async function loadDefaults(
  tx: DbOrTx,
  ownerId: string,
  scope: ServiceScope,
  category: string,
): Promise<ServiceRuleDefaultRow[]> {
  return tx
    .select()
    .from(serviceRuleDefault)
    .where(
      and(
        eq(serviceRuleDefault.ownerId, ownerId),
        eq(serviceRuleDefault.scope, scope),
        eq(serviceRuleDefault.category, category),
      ),
    )
    .orderBy(asc(serviceRuleDefault.name));
}

function itemRuleParentWhere(parentType: ServiceParentType, parentId: string) {
  return parentType === "firearm"
    ? eq(serviceRule.firearmId, parentId)
    : eq(serviceRule.accessoryId, parentId);
}

export async function loadItemRules(
  tx: DbOrTx,
  parentType: ServiceParentType,
  parentId: string,
): Promise<ServiceRuleRow[]> {
  return tx
    .select()
    .from(serviceRule)
    .where(itemRuleParentWhere(parentType, parentId))
    .orderBy(asc(serviceRule.name));
}

function belongsToParent(
  row: Pick<ServiceRuleRow, "firearmId" | "accessoryId">,
  parentType: ServiceParentType,
  parentId: string,
): boolean {
  return parentType === "firearm"
    ? row.firearmId === parentId
    : row.accessoryId === parentId;
}

/**
 * Shared duplicate-name guard for defaults and item rules alike (R2):
 * `excludeId` omitted means "creating new" (nothing to exclude); passing the
 * row's own id on an update lets it keep its current name. Thrown before any
 * write, so the DB's unique constraint is never what surfaces the error.
 */
function assertNameAvailable(
  siblings: Array<{ id: string; name: string }>,
  name: string,
  excludeId?: string,
): void {
  if (siblings.some((s) => s.id !== excludeId && s.name === name)) {
    throw new ValidationError(["duplicateName"]);
  }
}

/**
 * Resolve a firearm's owner and category (its `type`) for defaults lookup,
 * authorized through the firearm's own visibility (R6) so a view-grantee can
 * READ a shared firearm's rules. `NotFoundError` for an unseen firearm.
 * Exported for reuse by U4's `due-service.ts` (per-item due lookup needs the
 * exact same owner+category resolution, gated the same way).
 */
export async function requireFirearmVisible(
  tx: DbOrTx,
  actorId: string,
  firearmId: string,
): Promise<{ ownerId: string; category: string }> {
  const perm = await resolvePermission(tx, actorId, "firearm", firearmId);
  if (perm === null) throw new NotFoundError();
  const [row] = await tx
    .select({ ownerId: firearm.ownerId, type: firearm.type })
    .from(firearm)
    .where(eq(firearm.id, firearmId))
    .limit(1);
  if (!row) throw new NotFoundError();
  return { ownerId: row.ownerId, category: row.type };
}

/**
 * Resolve an accessory's owner and category directly by ownership. Per KTD3,
 * accessory rules and history never route through the mounted-firearm
 * visibility path (`resolveAccessoryPermission`), so a firearm grantee can
 * never see or touch configuration reserved to the accessory's own owner.
 * Not-owner and not-found are deliberately indistinguishable — this path
 * intentionally never consults the visibility layer that would tell them
 * apart. Exported for reuse by U4's `due-service.ts` (same accessory
 * owner-only resolution, KTD3).
 */
export async function requireAccessoryOwner(
  tx: DbOrTx,
  actorId: string,
  accessoryId: string,
): Promise<{ ownerId: string; category: string }> {
  const [row] = await tx
    .select({ ownerId: accessory.ownerId, category: accessory.category })
    .from(accessory)
    .where(eq(accessory.id, accessoryId))
    .limit(1);
  if (!row || row.ownerId !== actorId) throw new NotFoundError();
  return row;
}

/**
 * Authorize an item-rule WRITE (create/update/delete) per KTD3: firearms take
 * `authorizeOwnerOnlyUpdate` (owner-only; an edit-grantee is forbidden, not
 * merely unseen); accessories resolve ownership directly since they have no
 * `authorize.ts` gate — `assertWritesAllowed` is called explicitly here since
 * accessories don't route through `authorizeUpdate`'s built-in check.
 */
async function authorizeItemRuleWrite(
  tx: DbOrTx,
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
): Promise<void> {
  if (parentType === "firearm") {
    await authorizeOwnerOnlyUpdate(tx, actorId, "firearm", parentId);
    return;
  }
  await assertWritesAllowed(tx);
  await requireAccessoryOwner(tx, actorId, parentId);
}

async function repointServiceEvents(
  tx: DbOrTx,
  parentType: ServiceParentType,
  parentId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const parentWhere =
    parentType === "firearm"
      ? eq(serviceEvent.firearmId, parentId)
      : eq(serviceEvent.accessoryId, parentId);
  await tx
    .update(serviceEvent)
    .set({ ruleName: newName })
    .where(and(parentWhere, eq(serviceEvent.ruleName, oldName)));
}

// ---- category defaults CRUD (owner-scoped, no grant path) ----

/** An owner's default rule set for one scope+category, ordered by name. */
export async function listServiceRuleDefaults(
  actorId: string,
  scope: ServiceScope,
  category: string,
): Promise<ServiceRuleDefaultRow[]> {
  return loadDefaults(db, actorId, scope, category);
}

/**
 * Create a category default. Field-shape validation (empty name, threshold
 * bounds, missing threshold) runs before any transaction, matching
 * `createLogEntry`; the duplicate-name check needs a sibling read, so it runs
 * inside the transaction, before the insert.
 */
export async function createServiceRuleDefault(
  actorId: string,
  input: ServiceRuleDefaultInput,
): Promise<ServiceRuleDefaultRow> {
  const codes = validateServiceRuleSet([input]);
  if (codes.length > 0) throw new ValidationError(codes);

  const category = input.category.trim();
  const name = input.name.trim();

  return db.transaction(async (tx) => {
    await assertWritesAllowed(tx);
    const siblings = await loadDefaults(tx, actorId, input.scope, category);
    assertNameAvailable(siblings, name);
    const [row] = await tx
      .insert(serviceRuleDefault)
      .values({
        ownerId: actorId,
        scope: input.scope,
        category,
        name,
        intervalDays: input.intervalDays ?? null,
        intervalSessions: input.intervalSessions ?? null,
        intervalRounds: input.intervalRounds ?? null,
      })
      .returning();
    return row;
  });
}

/**
 * Update a category default's name/thresholds (full-replace, mirroring
 * `updateAccessory`'s shape). A rename onto a name a sibling default in the
 * same owner+scope+category already uses is rejected before the write.
 */
export async function updateServiceRuleDefault(
  actorId: string,
  defaultId: string,
  input: ServiceRuleDefaultUpdateInput,
): Promise<ServiceRuleDefaultRow> {
  const codes = validateServiceRuleSet([input]);
  if (codes.length > 0) throw new ValidationError(codes);

  const name = input.name.trim();

  return db.transaction(async (tx) => {
    await assertWritesAllowed(tx);
    const [existing] = await tx
      .select()
      .from(serviceRuleDefault)
      .where(eq(serviceRuleDefault.id, defaultId))
      .limit(1);
    if (!existing || existing.ownerId !== actorId) throw new NotFoundError();

    const siblings = await loadDefaults(
      tx,
      actorId,
      existing.scope as ServiceScope,
      existing.category,
    );
    assertNameAvailable(siblings, name, defaultId);

    const [row] = await tx
      .update(serviceRuleDefault)
      .set({
        name,
        intervalDays: input.intervalDays ?? null,
        intervalSessions: input.intervalSessions ?? null,
        intervalRounds: input.intervalRounds ?? null,
        updatedAt: new Date(),
      })
      .where(eq(serviceRuleDefault.id, defaultId))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

/** Delete a category default. Owner-only, matching every other default op. */
export async function deleteServiceRuleDefault(
  actorId: string,
  defaultId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await assertWritesAllowed(tx);
    const [existing] = await tx
      .select({ ownerId: serviceRuleDefault.ownerId })
      .from(serviceRuleDefault)
      .where(eq(serviceRuleDefault.id, defaultId))
      .limit(1);
    if (!existing || existing.ownerId !== actorId) throw new NotFoundError();
    await tx
      .delete(serviceRuleDefault)
      .where(eq(serviceRuleDefault.id, defaultId));
  });
}

// ---- item-rule CRUD (override, suppress, item-only; R5) ----

/**
 * Create an item rule: an override of a default, a suppression of one
 * (`suppressed: true`, thresholds forced null), or an item-only rule with no
 * matching default. Rejects a name already used by another rule on this same
 * item before the insert.
 *
 * `preloadedSiblings`, when supplied, is used in place of this function's own
 * `loadItemRules` call for the duplicate-name check — a caller that already
 * loaded this item's rules (e.g. `service-actions.ts`'s `findItemRuleByName`,
 * resolving which existing rule a UI action targets) can pass that list
 * through rather than have it reloaded here a second time. The authorization
 * check (`authorizeItemRuleWrite`) below is NEVER conditioned on this
 * parameter — it always runs, so this function stays safe to call directly
 * with no preload at all.
 */
export async function createItemRule(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
  input: ItemRuleInput,
  preloadedSiblings?: ServiceRuleRow[],
): Promise<ServiceRuleRow> {
  const codes = validateServiceRuleSet([input]);
  if (codes.length > 0) throw new ValidationError(codes);

  const name = input.name.trim();
  const suppressed = input.suppressed ?? false;

  return db.transaction(async (tx) => {
    await authorizeItemRuleWrite(tx, actorId, parentType, parentId);

    const siblings =
      preloadedSiblings ?? (await loadItemRules(tx, parentType, parentId));
    assertNameAvailable(siblings, name);

    const [row] = await tx
      .insert(serviceRule)
      .values({
        firearmId: parentType === "firearm" ? parentId : null,
        accessoryId: parentType === "accessory" ? parentId : null,
        name,
        suppressed,
        intervalDays: suppressed ? null : (input.intervalDays ?? null),
        intervalSessions: suppressed ? null : (input.intervalSessions ?? null),
        intervalRounds: suppressed ? null : (input.intervalRounds ?? null),
      })
      .returning();
    return row;
  });
}

/**
 * Update an item rule (full-replace). Renaming re-points that item's
 * `service_event` rows from the old `rule_name` to the new one in the same
 * transaction (KTD1); a rename onto a name the item already carries is
 * rejected with `ValidationError` before any write.
 *
 * `preloadedSiblings` — see `createItemRule`'s doc — is used in place of this
 * function's own `loadItemRules` call for the duplicate-name check, when
 * supplied. The authorization check below always runs regardless.
 */
export async function updateItemRule(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
  ruleId: string,
  input: ItemRuleInput,
  preloadedSiblings?: ServiceRuleRow[],
): Promise<ServiceRuleRow> {
  const codes = validateServiceRuleSet([input]);
  if (codes.length > 0) throw new ValidationError(codes);

  const name = input.name.trim();
  const suppressed = input.suppressed ?? false;

  return db.transaction(async (tx) => {
    await authorizeItemRuleWrite(tx, actorId, parentType, parentId);

    const [existing] = await tx
      .select()
      .from(serviceRule)
      .where(eq(serviceRule.id, ruleId))
      .limit(1);
    if (!existing || !belongsToParent(existing, parentType, parentId)) {
      throw new NotFoundError();
    }

    const siblings =
      preloadedSiblings ?? (await loadItemRules(tx, parentType, parentId));
    assertNameAvailable(siblings, name, ruleId);

    const [row] = await tx
      .update(serviceRule)
      .set({
        name,
        suppressed,
        intervalDays: suppressed ? null : (input.intervalDays ?? null),
        intervalSessions: suppressed ? null : (input.intervalSessions ?? null),
        intervalRounds: suppressed ? null : (input.intervalRounds ?? null),
        updatedAt: new Date(),
      })
      .where(eq(serviceRule.id, ruleId))
      .returning();
    if (!row) throw new NotFoundError();

    if (name !== existing.name) {
      await repointServiceEvents(tx, parentType, parentId, existing.name, name);
    }

    return row;
  });
}

/**
 * Delete an item rule: restores an overridden rule to inherited, or restores
 * a suppressed rule (R5). One row shape covers both (KTD6) — deleting it is
 * the only operation either restoration needs.
 */
export async function deleteItemRule(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
  ruleId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await authorizeItemRuleWrite(tx, actorId, parentType, parentId);

    const [existing] = await tx
      .select({
        firearmId: serviceRule.firearmId,
        accessoryId: serviceRule.accessoryId,
      })
      .from(serviceRule)
      .where(eq(serviceRule.id, ruleId))
      .limit(1);
    if (!existing || !belongsToParent(existing, parentType, parentId)) {
      throw new NotFoundError();
    }

    await tx.delete(serviceRule).where(eq(serviceRule.id, ruleId));
  });
}

// ---- reads ----

/**
 * An item's effective, resolved rule set (R4, R5) — defaults are loaded
 * against the ITEM'S OWNER, never the viewer, so a shared firearm's rules
 * always reflect its owner's configuration (R6). The live production read
 * path for this same resolution is `due-service.ts`'s `getItemDueState`,
 * which additionally annotates each rule with due state — there is no
 * production caller that wants resolution WITHOUT due annotation, so this
 * function was removed (its only callers were its own tests, since
 * re-pointed at `getItemDueState`).
 */

/** An item's own raw rule rows (overrides, suppressions, item-only rules). */
export async function listItemRules(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
): Promise<ServiceRuleRow[]> {
  if (parentType === "firearm") {
    await requireFirearmVisible(db, actorId, parentId);
  } else {
    await requireAccessoryOwner(db, actorId, parentId);
  }
  return loadItemRules(db, parentType, parentId);
}

/**
 * The owner's distinct accessory categories, alphabetically (KTD8) — powers
 * the defaults surface so a typo doesn't silently strand a whole category's
 * default set. Derived on read; nothing is stored.
 */
export async function listOwnerAccessoryCategories(
  actorId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: accessory.category })
    .from(accessory)
    .where(eq(accessory.ownerId, actorId))
    .orderBy(asc(accessory.category));
  return rows.map((row) => row.category);
}

/**
 * Every category the owner has configured at least one default for, in one
 * scope (U7) — alongside `listOwnerAccessoryCategories`, this is what lets
 * the defaults settings surface keep showing a category once it has been
 * armed (KTD8), even after its only matching accessory is deleted, or before
 * one ever existed. Firearm categories never need this: `FIREARM_TYPES` is
 * the fixed, already-known list.
 */
export async function listConfiguredCategories(
  actorId: string,
  scope: ServiceScope,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: serviceRuleDefault.category })
    .from(serviceRuleDefault)
    .where(
      and(
        eq(serviceRuleDefault.ownerId, actorId),
        eq(serviceRuleDefault.scope, scope),
      ),
    )
    .orderBy(asc(serviceRuleDefault.category));
  return rows.map((row) => row.category);
}

/**
 * Count of the owner's items in one category — firearms of a `type`, or
 * accessories of a `category` (U7). Surfaced next to each category on the
 * defaults settings screen so editing or deleting a default states plainly
 * how many items it reaches (R4's live-inheritance consequence) before the
 * owner saves. A plain per-category count, not a per-rule one: every item in
 * the category resolves some version of every rule in the set (its own
 * override, or the default), so "how many items does this category's default
 * set reach" is answered at the category level, one step up from any single
 * rule's override state.
 */
export async function countItemsInCategory(
  actorId: string,
  scope: ServiceScope,
  category: string,
): Promise<number> {
  const [row] =
    scope === "firearm"
      ? await db
          .select({ total: count() })
          .from(firearm)
          .where(and(eq(firearm.ownerId, actorId), eq(firearm.type, category)))
      : await db
          .select({ total: count() })
          .from(accessory)
          .where(
            and(
              eq(accessory.ownerId, actorId),
              eq(accessory.category, category),
            ),
          );
  return row?.total ?? 0;
}

/**
 * Every one of the owner's default rule sets for one scope, grouped by
 * category, in a single query (U7's settings page) — the batched counterpart
 * to calling `listServiceRuleDefaults` once per category, which the settings
 * page's `loadSections` used to do (once per firearm type, once per
 * accessory category), breaking the batching discipline the rest of the
 * service-intervals feature follows (KTD4-style, though this page predates
 * that pin). A category with no defaults yet is simply absent from the map.
 */
export async function listServiceRuleDefaultsByCategory(
  actorId: string,
  scope: ServiceScope,
): Promise<Map<string, ServiceRuleDefaultRow[]>> {
  const rows = await db
    .select()
    .from(serviceRuleDefault)
    .where(
      and(
        eq(serviceRuleDefault.ownerId, actorId),
        eq(serviceRuleDefault.scope, scope),
      ),
    )
    .orderBy(asc(serviceRuleDefault.category), asc(serviceRuleDefault.name));

  const byCategory = new Map<string, ServiceRuleDefaultRow[]>();
  for (const row of rows) {
    const rules = byCategory.get(row.category) ?? [];
    rules.push(row);
    byCategory.set(row.category, rules);
  }
  return byCategory;
}

/**
 * The owner's item count per category for one scope, in a single `GROUP BY`
 * query (U7's settings page) — the batched counterpart to calling
 * `countItemsInCategory` once per category. A category with no items yet is
 * simply absent from the map (callers read that as zero, matching
 * `countItemsInCategory`'s `row?.total ?? 0` fallback).
 */
export async function countItemsByCategory(
  actorId: string,
  scope: ServiceScope,
): Promise<Map<string, number>> {
  const rows =
    scope === "firearm"
      ? await db
          .select({ category: firearm.type, total: count() })
          .from(firearm)
          .where(eq(firearm.ownerId, actorId))
          .groupBy(firearm.type)
      : await db
          .select({ category: accessory.category, total: count() })
          .from(accessory)
          .where(eq(accessory.ownerId, actorId))
          .groupBy(accessory.category);
  return new Map(rows.map((row) => [row.category, row.total]));
}
