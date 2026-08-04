import { and, asc, count, eq, inArray } from "drizzle-orm";
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
 *
 * Renaming a CATEGORY DEFAULT applies the same precedent one level up
 * (`updateServiceRuleDefault`'s `repointDefaultRename`): every one of the
 * owner's own items in that exact scope+category that carries the old name —
 * whether inheriting (only `service_event` rows) or overriding/suppressing
 * (its own `service_rule` row too) — moves to the new name in the same
 * transaction, so no item's service history is silently stranded on a name
 * nothing measures from any more. See that function's doc for why a
 * genuinely item-only rule can never be caught up in this rename.
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
 *
 * This is a fast-path pre-check only, not the sole guarantee against a
 * duplicate name: under READ COMMITTED, two concurrent writes (e.g. a double
 * submit) can both pass this check and both reach the insert/update below.
 * `isUniqueNameViolation` + the try/catch in each write function is the
 * backstop that catches that race at the DB's unique constraints
 * (`service_rule_default_owner_scope_category_name_unique`,
 * `service_rule_firearm_name_unique`, `service_rule_accessory_name_unique` —
 * `src/db/migrations/0019_perfect_nebula.sql`) and maps the loser to the same
 * clean `ValidationError(["duplicateName"])` this pre-check produces, instead
 * of letting the raw Postgres driver error (SQLSTATE `23505`) escape.
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

/** Postgres SQLSTATE for "unique_violation". */
const POSTGRES_UNIQUE_VIOLATION = "23505";

function hasUniqueViolationCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

/**
 * True when `error` is the `pg` driver's unique-constraint-violation error
 * (`.code === "23505"`, the Postgres SQLSTATE) — the race-condition backstop
 * behind `assertNameAvailable`'s pre-check (see that function's doc). Only
 * matches this specific code so every other DB error still propagates
 * unchanged; a caller that wants to also confirm WHICH constraint fired can
 * read `.constraint` off the same error object (also set by `pg` on a
 * unique-violation), but the four call sites here don't need to distinguish
 * between the three service-rule unique constraints — all three mean the
 * same thing to the caller: this name is already taken.
 *
 * Checks `error.cause` too: drizzle's `db.transaction`/query layer wraps the
 * raw `pg` driver error in its own `DrizzleQueryError`, with the original
 * error (carrying `.code`) as `.cause` — the write functions here would never
 * see the bare `pg` error directly.
 */
function isUniqueNameViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) return true;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return hasUniqueViolationCode(cause);
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

/**
 * This owner's own item ids in one scope+category (KTD3: strictly the
 * owner's own items, in the exact category the default row itself carries —
 * a firearm's `type` or an accessory's `category`, never a fuzzy match).
 * Shared by `repointDefaultRename` below, since both halves of that repoint
 * (item-rule rows and service-event rows) key off the same item set.
 */
async function loadCategoryItemIds(
  tx: DbOrTx,
  ownerId: string,
  scope: ServiceScope,
  category: string,
): Promise<string[]> {
  if (scope === "firearm") {
    const rows = await tx
      .select({ id: firearm.id })
      .from(firearm)
      .where(and(eq(firearm.ownerId, ownerId), eq(firearm.type, category)));
    return rows.map((row) => row.id);
  }
  const rows = await tx
    .select({ id: accessory.id })
    .from(accessory)
    .where(
      and(eq(accessory.ownerId, ownerId), eq(accessory.category, category)),
    );
  return rows.map((row) => row.id);
}

/**
 * Repoint every dependent row a category-default rename would otherwise
 * strand — the same bug class `updateItemRule`'s `repointServiceEvents`
 * above already fixes for an item-level rename, applied one level up (PR #99
 * review, P2): everything here is keyed by rule NAME (KTD1), so renaming a
 * default silently orphaned the service history of every item inheriting or
 * overriding it, which then reappeared under the new name with no history,
 * measuring from the item's origin date again.
 *
 * - An item that INHERITS this default (no `service_rule` row of its own)
 *   has only `service_event` rows named `oldName` to repoint.
 * - An item that OVERRIDES or SUPPRESSES this default carries `oldName` on
 *   its own `service_rule` row too — that row moves to `newName` alongside
 *   its `service_event` rows, so the override/suppression keeps applying to
 *   the renamed default instead of silently reverting to "inherited" under a
 *   name nothing measures any more.
 * - A GENUINELY item-only rule (one no default in this category names) can
 *   never be caught up in this rename despite sharing `oldName`, so there is
 *   no ambiguous case to special-case here: `resolveEffectiveRules`
 *   (`derive.ts`) matches an item's own `service_rule` row to a default BY
 *   NAME ALONE, against that item's own category's default set. This
 *   function only ever touches items in the SAME owner + SAME scope+category
 *   as the default being renamed — so any `service_rule` row it finds named
 *   `oldName` is, by that identical name-matching logic, ALREADY being
 *   resolved as an override or a suppression of exactly this default, never
 *   as item-only. An item-only rule is by definition one no default defines;
 *   a default of this exact name already existing in this exact category is
 *   what rules out the item-only reading for every row this function could
 *   possibly touch. Every matching `service_rule` row here is therefore an
 *   override/suppression and must move with the rename.
 *
 * Scoped strictly to `ownerId`'s own items (KTD3) — never touches another
 * owner's rows, even one with an identically-named default in the same
 * category.
 */
async function repointDefaultRename(
  tx: DbOrTx,
  ownerId: string,
  scope: ServiceScope,
  category: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const itemIds = await loadCategoryItemIds(tx, ownerId, scope, category);
  if (itemIds.length === 0) return;

  const ruleParentColumn =
    scope === "firearm" ? serviceRule.firearmId : serviceRule.accessoryId;
  const eventParentColumn =
    scope === "firearm" ? serviceEvent.firearmId : serviceEvent.accessoryId;

  // Overrides/suppressions first: their `service_rule` row carries the old
  // name too, alongside any `service_event` rows the loop below also moves.
  await tx
    .update(serviceRule)
    .set({ name: newName, updatedAt: new Date() })
    .where(
      and(inArray(ruleParentColumn, itemIds), eq(serviceRule.name, oldName)),
    );

  await tx
    .update(serviceEvent)
    .set({ ruleName: newName })
    .where(
      and(
        inArray(eventParentColumn, itemIds),
        eq(serviceEvent.ruleName, oldName),
      ),
    );
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

  try {
    return await db.transaction(async (tx) => {
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
  } catch (error: unknown) {
    if (isUniqueNameViolation(error))
      throw new ValidationError(["duplicateName"]);
    throw error;
  }
}

/**
 * Update a category default's name/thresholds (full-replace, mirroring
 * `updateAccessory`'s shape). A rename onto a name a sibling default in the
 * same owner+scope+category already uses is rejected before the write.
 *
 * Renaming re-points every dependent row `repointDefaultRename` finds for
 * this owner's own items in this exact scope+category, in the same
 * transaction (see that function's doc for the full scope reasoning) — the
 * default-level counterpart to `updateItemRule`'s item-level rename repoint.
 */
export async function updateServiceRuleDefault(
  actorId: string,
  defaultId: string,
  input: ServiceRuleDefaultUpdateInput,
): Promise<ServiceRuleDefaultRow> {
  const codes = validateServiceRuleSet([input]);
  if (codes.length > 0) throw new ValidationError(codes);

  const name = input.name.trim();

  try {
    return await db.transaction(async (tx) => {
      await assertWritesAllowed(tx);

      // FOR UPDATE (mirrors `updateItemRule`'s F5 fix, same concurrency
      // hazard one level up): locks this row for the rest of the
      // transaction, so `existing.name` — what `repointDefaultRename` below
      // repoints FROM — is always the name actually on the row, never a
      // name a second, overlapping rename already moved past. Without the
      // lock, two concurrent renames of the same default both read the
      // row's starting name before either commits; whichever commits second
      // then repoints dependent rows FROM that stale starting name, matching
      // zero rows (the first rename already moved them), and strands history
      // on the intermediate name.
      const [existing] = await tx
        .select()
        .from(serviceRuleDefault)
        .where(eq(serviceRuleDefault.id, defaultId))
        .for("update")
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

      if (name !== existing.name) {
        await repointDefaultRename(
          tx,
          actorId,
          existing.scope as ServiceScope,
          existing.category,
          existing.name,
          name,
        );
      }

      return row;
    });
  } catch (error: unknown) {
    if (isUniqueNameViolation(error))
      throw new ValidationError(["duplicateName"]);
    throw error;
  }
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

  try {
    return await db.transaction(async (tx) => {
      await authorizeItemRuleWrite(tx, actorId, parentType, parentId);

      const siblings =
        preloadedSiblings ?? (await loadItemRules(tx, parentType, parentId));
      assertNameAvailable(siblings, name);

      // `validateServiceRuleSet` above already rejects `suppressed: true` WITH
      // any threshold submitted (`suppressedWithThresholds`, F7 fix), so this
      // ternary is defense-in-depth, not the primary guarantee: a suppressed
      // rule's thresholds are always absent by the time we reach here.
      const [row] = await tx
        .insert(serviceRule)
        .values({
          firearmId: parentType === "firearm" ? parentId : null,
          accessoryId: parentType === "accessory" ? parentId : null,
          name,
          suppressed,
          intervalDays: suppressed ? null : (input.intervalDays ?? null),
          intervalSessions: suppressed
            ? null
            : (input.intervalSessions ?? null),
          intervalRounds: suppressed ? null : (input.intervalRounds ?? null),
        })
        .returning();
      return row;
    });
  } catch (error: unknown) {
    if (isUniqueNameViolation(error))
      throw new ValidationError(["duplicateName"]);
    throw error;
  }
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

  try {
    return await db.transaction(async (tx) => {
      await authorizeItemRuleWrite(tx, actorId, parentType, parentId);

      // FOR UPDATE (F5 fix): locks this row for the rest of the transaction,
      // so `existing.name` — what `repointServiceEvents` below repoints FROM —
      // is always the name actually on the row, never a name a second,
      // overlapping rename already moved past. Without the lock, two
      // concurrent renames of the same rule both read the row's starting name
      // before either commits; whichever commits second then repoints events
      // FROM that stale starting name, matching zero rows (the first rename
      // already moved them), and strands history on the intermediate name. The
      // lock forces the second transaction's read to block until the first
      // commits, so it re-reads the name the first rename actually left
      // behind — mirroring `magazines/service.ts`'s `updateMagazine` lock.
      const [existing] = await tx
        .select()
        .from(serviceRule)
        .where(eq(serviceRule.id, ruleId))
        .for("update")
        .limit(1);
      if (!existing || !belongsToParent(existing, parentType, parentId)) {
        throw new NotFoundError();
      }

      const siblings =
        preloadedSiblings ?? (await loadItemRules(tx, parentType, parentId));
      assertNameAvailable(siblings, name, ruleId);

      // `validateServiceRuleSet` above already rejects `suppressed: true` WITH
      // any threshold submitted (`suppressedWithThresholds`, F7 fix), so this
      // ternary is defense-in-depth, not the primary guarantee.
      const [row] = await tx
        .update(serviceRule)
        .set({
          name,
          suppressed,
          intervalDays: suppressed ? null : (input.intervalDays ?? null),
          intervalSessions: suppressed
            ? null
            : (input.intervalSessions ?? null),
          intervalRounds: suppressed ? null : (input.intervalRounds ?? null),
          updatedAt: new Date(),
        })
        .where(eq(serviceRule.id, ruleId))
        .returning();
      if (!row) throw new NotFoundError();

      if (name !== existing.name) {
        await repointServiceEvents(
          tx,
          parentType,
          parentId,
          existing.name,
          name,
        );
      }

      return row;
    });
  } catch (error: unknown) {
    if (isUniqueNameViolation(error))
      throw new ValidationError(["duplicateName"]);
    throw error;
  }
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
