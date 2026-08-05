import { parseISO } from "date-fns";
import { and, eq, inArray, max } from "drizzle-orm";
import { getVisibleIds } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import {
  accessory,
  firearm,
  rangeSession,
  rangeSessionAccessory,
  serviceEvent,
  serviceRule,
  serviceRuleDefault,
} from "@/src/db/schema";
import { listFirearms } from "../firearms/service";
import {
  type DefaultRule,
  type DueResult,
  type ElapsedCounts,
  elapsedCounts,
  type ItemRule,
  isDue,
  type ResolvedRule,
  resolveEffectiveRules,
  type SessionRow,
} from "./derive";
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

/**
 * Due-resolution layer (service-intervals plan, U4). Loads what U2's pure
 * `derive.ts` functions need — defaults, item rules, the last service point
 * per rule, and session rows — and applies them. NOTHING here decides due
 * state; every threshold comparison happens in `derive.ts` (KTD4).
 *
 * Two entry points:
 * - `getItemDueState` resolves one item (firearm or accessory), authorized
 *   the same way `rules-service.ts` reads are (a firearm by its own
 *   visibility, R6; an accessory by direct ownership, KTD3).
 * - `listDueForVisibleCollection` resolves EVERY visible item in a BOUNDED
 *   number of queries, regardless of collection size (Definition of Done,
 *   U4): one batched load per data source (owners' defaults, item rules,
 *   last-service-points, session rows), never a per-item query.
 *
 * Origin date resolves per family (KTD9, updated during implementation): a
 * firearm's `acquired_date` when set, else its `created_at`, as a calendar
 * date; an accessory's `acquired_date` when set, else its `created_at`,
 * EXACTLY parallel to the firearm resolution — accessories gained their own
 * `acquired_date` after the plan's original scope (see the plan's "Scope
 * added during implementation" note): leaving accessories on `created_at`
 * alone reproduced R22's cold-start problem on the smaller half of the
 * feature, where an accessory owned for years but entered today read as
 * not-due on day one. `installed_date` still can't serve as an origin — it
 * is force-nulled on unmount — but `acquired_date` is never touched by mount
 * state, so it's stable. `acquired_date`/`serviced_on` are stored as Postgres `date` (a plain
 * `YYYY-MM-DD` string); `parseISO` on a date-only string resolves to LOCAL
 * midnight (KTD5), matching how `magazines/inventory-filter.ts` already
 * parses stored calendar dates. `created_at` is already a `Date` instance
 * (a `timestamp` column) and needs no parsing — `elapsedCounts`'s calendar-
 * day comparison only ever reads its local Y/M/D, never its time-of-day.
 */

/**
 * One resolved rule plus its computed elapsed counts and due state.
 *
 * Intersected with `DueResult` (a discriminated union) rather than declared
 * as a flat interface with `due: boolean; trippedAxis: ServiceAxis | null`,
 * so a `due: true` entry carries a guaranteed non-null `trippedAxis` at the
 * type level, matching what `isDue` actually ever produces — no consumer has
 * to null-check an axis the logic already guarantees is present.
 */
export type RuleDueState = ResolvedRule & {
  measureFrom: Date;
  counts: ElapsedCounts;
} & DueResult;

/**
 * One visible item's resolved, due-annotated rule set. Omitted entirely from
 * `listDueForVisibleCollection` when it has no effective rules — an item
 * with nothing to track contributes nothing to the collection view.
 */
export interface ItemDueEntry {
  parentType: ServiceParentType;
  parentId: string;
  rules: RuleDueState[];
}

function measureFromFor(
  lastServicedOn: string | undefined,
  originDate: Date,
): Date {
  return lastServicedOn !== undefined ? parseISO(lastServicedOn) : originDate;
}

function applyDue(
  rule: ResolvedRule,
  lastServicedOn: string | undefined,
  originDate: Date,
  sessions: SessionRow[],
  asOf: Date,
): RuleDueState {
  const measureFrom = measureFromFor(lastServicedOn, originDate);
  const counts = elapsedCounts(measureFrom, sessions, asOf);
  const dueResult = isDue(rule, counts);
  // Branch explicitly on the discriminant (rather than spreading `dueResult`
  // directly) so each branch's literal `trippedAxis` type is preserved —
  // spreading a union type into an object literal does not reliably narrow
  // the result back to a union, which is what `RuleDueState` needs to keep
  // its `due: true` branch's `trippedAxis` guaranteed non-null.
  if (dueResult.due) {
    return {
      ...rule,
      measureFrom,
      counts,
      due: true,
      trippedAxis: dueResult.trippedAxis,
    };
  }
  return { ...rule, measureFrom, counts, due: false, trippedAxis: null };
}

function resolveDueRules(
  resolved: ResolvedRule[],
  lastByRule: Map<string, string>,
  originDate: Date,
  sessions: SessionRow[],
  asOf: Date,
): RuleDueState[] {
  return resolved.map((rule) =>
    applyDue(rule, lastByRule.get(rule.name), originDate, sessions, asOf),
  );
}

// ---- batched loaders (bounded: one query per data source, KTD4) ----

function eventParentColumn(parentType: ServiceParentType) {
  return parentType === "firearm"
    ? serviceEvent.firearmId
    : serviceEvent.accessoryId;
}

function ruleParentColumn(parentType: ServiceParentType) {
  return parentType === "firearm"
    ? serviceRule.firearmId
    : serviceRule.accessoryId;
}

/**
 * Latest `serviced_on` per (item, rule name), grouped over many parent ids
 * at once (mirrors `loadLastInventoriedBatch`'s batched grouped-`max`
 * shape, extended with a second group-by column since each rule on an item
 * measures from its OWN last service point, not the item's overall last
 * event). An (item, rule) pair with no event is absent from the inner map —
 * the caller reads that as "measure from origin" (R10).
 */
async function loadLastServicePointBatch(
  tx: DbOrTx,
  parentType: ServiceParentType,
  parentIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const byItem = new Map<string, Map<string, string>>();
  if (parentIds.length === 0) return byItem;

  const column = eventParentColumn(parentType);
  const rows = await tx
    .select({
      parentId: column,
      ruleName: serviceEvent.ruleName,
      last: max(serviceEvent.servicedOn),
    })
    .from(serviceEvent)
    .where(inArray(column, parentIds))
    .groupBy(column, serviceEvent.ruleName);

  for (const row of rows) {
    if (row.parentId === null || row.last === null) continue; // defensive; groupBy never yields this
    const byRule = byItem.get(row.parentId) ?? new Map<string, string>();
    byRule.set(row.ruleName, row.last);
    byItem.set(row.parentId, byRule);
  }
  return byItem;
}

/** Item rule rows for many parents at once, grouped by parent id. */
async function loadItemRulesBatch(
  tx: DbOrTx,
  parentType: ServiceParentType,
  parentIds: string[],
): Promise<Map<string, ItemRule[]>> {
  const byItem = new Map<string, ItemRule[]>();
  if (parentIds.length === 0) return byItem;

  const column = ruleParentColumn(parentType);
  const rows = await tx
    .select()
    .from(serviceRule)
    .where(inArray(column, parentIds));

  for (const row of rows) {
    const parent = resolveParent(row);
    if (parent === null) continue; // defensive; the exactly-one-parent CHECK guarantees this
    const rules = byItem.get(parent.parentId) ?? [];
    rules.push(toItemRule(row));
    byItem.set(parent.parentId, rules);
  }
  return byItem;
}

function defaultsKey(ownerId: string, category: string): string {
  return `${ownerId}::${category}`;
}

/** Every listed owner's default rule set for one scope, grouped by owner+category. */
async function loadDefaultsForOwnersBatch(
  tx: DbOrTx,
  scope: ServiceParentType,
  ownerIds: string[],
): Promise<Map<string, DefaultRule[]>> {
  const byOwnerCategory = new Map<string, DefaultRule[]>();
  if (ownerIds.length === 0) return byOwnerCategory;

  const rows = await tx
    .select()
    .from(serviceRuleDefault)
    .where(
      and(
        eq(serviceRuleDefault.scope, scope),
        inArray(serviceRuleDefault.ownerId, ownerIds),
      ),
    );

  for (const row of rows) {
    const key = defaultsKey(row.ownerId, row.category);
    const rules = byOwnerCategory.get(key) ?? [];
    rules.push(toDefaultRule(row));
    byOwnerCategory.set(key, rules);
  }
  return byOwnerCategory;
}

/** Range-session rows for many firearms at once, grouped by firearm id. */
async function loadFirearmSessionsBatch(
  tx: DbOrTx,
  firearmIds: string[],
): Promise<Map<string, SessionRow[]>> {
  const byFirearm = new Map<string, SessionRow[]>();
  if (firearmIds.length === 0) return byFirearm;

  const rows = await tx
    .select({
      firearmId: rangeSession.firearmId,
      date: rangeSession.date,
      roundsFired: rangeSession.roundsFired,
    })
    .from(rangeSession)
    .where(inArray(rangeSession.firearmId, firearmIds));

  for (const row of rows) {
    const sessions = byFirearm.get(row.firearmId) ?? [];
    sessions.push({ date: parseISO(row.date), roundsFired: row.roundsFired });
    byFirearm.set(row.firearmId, sessions);
  }
  return byFirearm;
}

/**
 * Range-session rows attributable to many accessories at once, grouped by
 * accessory id — restricted to sessions whose FIREARM is in
 * `visibleFirearmIds` (R9's security requirement, mirroring
 * `accessoryRoundsFired`'s join): without that restriction, a remounted
 * accessory would leak rounds fired on a firearm the actor cannot see. An
 * accessory whose only mounted sessions belong to an invisible firearm
 * contributes no rounds — it is simply absent from the returned map.
 */
async function loadAccessorySessionsBatch(
  tx: DbOrTx,
  accessoryIds: string[],
  visibleFirearmIds: string[],
): Promise<Map<string, SessionRow[]>> {
  const byAccessory = new Map<string, SessionRow[]>();
  if (accessoryIds.length === 0 || visibleFirearmIds.length === 0) {
    return byAccessory;
  }

  const rows = await tx
    .select({
      accessoryId: rangeSessionAccessory.accessoryId,
      date: rangeSession.date,
      roundsFired: rangeSession.roundsFired,
    })
    .from(rangeSessionAccessory)
    .innerJoin(
      rangeSession,
      eq(rangeSessionAccessory.rangeSessionId, rangeSession.id),
    )
    .where(
      and(
        inArray(rangeSessionAccessory.accessoryId, accessoryIds),
        inArray(rangeSession.firearmId, visibleFirearmIds),
      ),
    );

  for (const row of rows) {
    if (row.accessoryId === null) continue;
    const sessions = byAccessory.get(row.accessoryId) ?? [];
    sessions.push({ date: parseISO(row.date), roundsFired: row.roundsFired });
    byAccessory.set(row.accessoryId, sessions);
  }
  return byAccessory;
}

// ---- per-item due resolution ----

/**
 * An item's origin date (KTD9, updated during implementation) — shared by
 * both firearms and accessories: `acquiredDate` when set, else `createdAt`.
 * Accessories gained their own `acquiredDate` after the plan's original
 * scope (see this file's header comment), at which point their resolution
 * became byte-identical to the firearm one, so both families share this one
 * function instead of two copies (KISS/DRY).
 */
function itemOriginDate(row: {
  acquiredDate: string | null;
  createdAt: Date;
}): Date {
  return row.acquiredDate !== null ? parseISO(row.acquiredDate) : row.createdAt;
}

/** `getItemDueState`'s firearm branch — a firearm by its own visibility (R6). */
async function getFirearmDueState(
  actorId: string,
  parentId: string,
  asOf: Date,
): Promise<RuleDueState[]> {
  const { ownerId, category } = await requireFirearmVisible(
    db,
    actorId,
    parentId,
  );
  const [defaultRows, itemRuleRows, lastByItem, sessions, [row]] =
    await Promise.all([
      loadDefaults(db, ownerId, "firearm", category),
      loadItemRules(db, "firearm", parentId),
      loadLastServicePointBatch(db, "firearm", [parentId]),
      loadFirearmSessionsBatch(db, [parentId]).then(
        (byFirearm) => byFirearm.get(parentId) ?? [],
      ),
      db
        .select({
          acquiredDate: firearm.acquiredDate,
          createdAt: firearm.createdAt,
        })
        .from(firearm)
        .where(eq(firearm.id, parentId))
        .limit(1),
    ]);
  if (!row) return []; // defensive; requireFirearmVisible already confirmed existence

  const resolved = resolveEffectiveRules(
    defaultRows.map(toDefaultRule),
    itemRuleRows.map(toItemRule),
  );
  const lastByRule = lastByItem.get(parentId) ?? new Map<string, string>();
  return resolveDueRules(
    resolved,
    lastByRule,
    itemOriginDate(row),
    sessions,
    asOf,
  );
}

/** `getItemDueState`'s accessory branch — direct ownership only (KTD3). */
async function getAccessoryDueState(
  actorId: string,
  parentId: string,
  asOf: Date,
): Promise<RuleDueState[]> {
  const { ownerId, category } = await requireAccessoryOwner(
    db,
    actorId,
    parentId,
  );
  const [defaultRows, itemRuleRows, lastByItem, visibleFirearmIds, [row]] =
    await Promise.all([
      loadDefaults(db, ownerId, "accessory", category),
      loadItemRules(db, "accessory", parentId),
      loadLastServicePointBatch(db, "accessory", [parentId]),
      getVisibleIds(db, actorId, "firearm"),
      db
        .select({
          acquiredDate: accessory.acquiredDate,
          createdAt: accessory.createdAt,
        })
        .from(accessory)
        .where(eq(accessory.id, parentId))
        .limit(1),
    ]);
  if (!row) return []; // defensive; requireAccessoryOwner already confirmed existence

  const sessions = await loadAccessorySessionsBatch(
    db,
    [parentId],
    [...visibleFirearmIds],
  ).then((byAccessory) => byAccessory.get(parentId) ?? []);

  const resolved = resolveEffectiveRules(
    defaultRows.map(toDefaultRule),
    itemRuleRows.map(toItemRule),
  );
  const lastByRule = lastByItem.get(parentId) ?? new Map<string, string>();
  return resolveDueRules(
    resolved,
    lastByRule,
    itemOriginDate(row),
    sessions,
    asOf,
  );
}

/**
 * One item's resolved, due-annotated rule set (R7–R10, R12). Authorized the
 * same way `rules-service.ts` reads are: a firearm by its own visibility
 * (any of owner/edit/view, R6); an accessory by direct ownership (KTD3).
 * Defaults are loaded against the ITEM'S OWNER, never the viewer, so a
 * shared firearm's rules always reflect its owner's configuration (R6).
 * `asOf` defaults to "now" but is an explicit parameter so callers (and
 * tests) can pin it.
 */
export async function getItemDueState(
  actorId: string,
  parentType: ServiceParentType,
  parentId: string,
  asOf: Date = new Date(),
): Promise<RuleDueState[]> {
  return parentType === "firearm"
    ? getFirearmDueState(actorId, parentId, asOf)
    : getAccessoryDueState(actorId, parentId, asOf);
}

// ---- collection-wide due resolution (bounded query count, KTD4) ----

type FirearmRow = typeof firearm.$inferSelect;
type AccessoryRow = typeof accessory.$inferSelect;

/** Resolve one firearm's due entry, or `null` when it has no effective rules. */
function buildFirearmEntry(
  fa: FirearmRow,
  defaultsByKey: Map<string, DefaultRule[]>,
  rulesByItem: Map<string, ItemRule[]>,
  lastByItem: Map<string, Map<string, string>>,
  sessionsByItem: Map<string, SessionRow[]>,
  asOf: Date,
): ItemDueEntry | null {
  const defaults = defaultsByKey.get(defaultsKey(fa.ownerId, fa.type)) ?? [];
  const itemRules = rulesByItem.get(fa.id) ?? [];
  const resolved = resolveEffectiveRules(defaults, itemRules);
  if (resolved.length === 0) return null;

  const lastByRule = lastByItem.get(fa.id) ?? new Map<string, string>();
  const sessions = sessionsByItem.get(fa.id) ?? [];
  return {
    parentType: "firearm",
    parentId: fa.id,
    rules: resolveDueRules(
      resolved,
      lastByRule,
      itemOriginDate(fa),
      sessions,
      asOf,
    ),
  };
}

/** Resolve one accessory's due entry, or `null` when it has no effective rules. */
function buildAccessoryEntry(
  acc: AccessoryRow,
  defaultsByKey: Map<string, DefaultRule[]>,
  rulesByItem: Map<string, ItemRule[]>,
  lastByItem: Map<string, Map<string, string>>,
  sessionsByItem: Map<string, SessionRow[]>,
  asOf: Date,
): ItemDueEntry | null {
  const defaults =
    defaultsByKey.get(defaultsKey(acc.ownerId, acc.category)) ?? [];
  const itemRules = rulesByItem.get(acc.id) ?? [];
  const resolved = resolveEffectiveRules(defaults, itemRules);
  if (resolved.length === 0) return null;

  const lastByRule = lastByItem.get(acc.id) ?? new Map<string, string>();
  const sessions = sessionsByItem.get(acc.id) ?? [];
  return {
    parentType: "accessory",
    parentId: acc.id,
    rules: resolveDueRules(
      resolved,
      lastByRule,
      itemOriginDate(acc),
      sessions,
      asOf,
    ),
  };
}

/**
 * The actor's visible firearms and OWNED (never granted/mounted-inherited)
 * accessories — see the accessory-scope comment on `listDueForVisibleCollection`.
 * Accepts an optional `visibleFirearmsAlreadyLoaded` — the same visible-firearm
 * set a caller (e.g. the firearms list page) has often already fetched for its
 * own purposes — to skip re-running `listFirearms`'s two round trips
 * (`getVisibleIds` + select). Falls back to a fresh load when not supplied.
 */
async function loadVisibleItems(
  actorId: string,
  visibleFirearmsAlreadyLoaded?: FirearmRow[],
): Promise<{ firearms: FirearmRow[]; accessories: AccessoryRow[] }> {
  const [firearms, accessories] = await Promise.all([
    visibleFirearmsAlreadyLoaded ?? listFirearms(actorId),
    // Deliberately NOT `listAccessories(actorId)` — that returns owned ∪
    // mounted-on-a-visible-firearm accessories, which would surface a
    // GRANTEE'S shared firearm's mounted accessory (owned by someone else)
    // here. Accessory service is owner-only throughout (KTD3), so the
    // collection-wide accessory scope is `owner_id = actorId`, full stop —
    // never the broader mount-inheritance visibility the general accessory
    // list uses.
    db.select().from(accessory).where(eq(accessory.ownerId, actorId)),
  ]);
  return { firearms, accessories };
}

/** Every batched data source `buildFirearmEntry`/`buildAccessoryEntry` need. */
interface BatchedDueData {
  firearmDefaults: Map<string, DefaultRule[]>;
  accessoryDefaults: Map<string, DefaultRule[]>;
  firearmRules: Map<string, ItemRule[]>;
  accessoryRules: Map<string, ItemRule[]>;
  firearmLast: Map<string, Map<string, string>>;
  accessoryLast: Map<string, Map<string, string>>;
  firearmSessions: Map<string, SessionRow[]>;
  accessorySessions: Map<string, SessionRow[]>;
}

/** One batched load per data source (KTD4) — never a per-item query. */
async function loadBatchedDueData(
  firearms: FirearmRow[],
  accessories: AccessoryRow[],
  actorId: string,
): Promise<BatchedDueData> {
  const firearmIds = firearms.map((f) => f.id);
  const accessoryIds = accessories.map((a) => a.id);
  const firearmOwnerIds = [...new Set(firearms.map((f) => f.ownerId))];
  // Every accessory here is already scoped to `actorId` (see
  // `loadVisibleItems`), so there is exactly one accessory owner to load
  // defaults for.
  const accessoryOwnerIds = accessories.length > 0 ? [actorId] : [];

  const [
    firearmDefaults,
    accessoryDefaults,
    firearmRules,
    accessoryRules,
    firearmLast,
    accessoryLast,
    firearmSessions,
    accessorySessions,
  ] = await Promise.all([
    loadDefaultsForOwnersBatch(db, "firearm", firearmOwnerIds),
    loadDefaultsForOwnersBatch(db, "accessory", accessoryOwnerIds),
    loadItemRulesBatch(db, "firearm", firearmIds),
    loadItemRulesBatch(db, "accessory", accessoryIds),
    loadLastServicePointBatch(db, "firearm", firearmIds),
    loadLastServicePointBatch(db, "accessory", accessoryIds),
    loadFirearmSessionsBatch(db, firearmIds),
    loadAccessorySessionsBatch(db, accessoryIds, firearmIds),
  ]);

  return {
    firearmDefaults,
    accessoryDefaults,
    firearmRules,
    accessoryRules,
    firearmLast,
    accessoryLast,
    firearmSessions,
    accessorySessions,
  };
}

const isPresent = (e: ItemDueEntry | null): e is ItemDueEntry => e !== null;

/**
 * Due state for EVERY item visible to `actorId`, in a bounded number of
 * queries regardless of how many items are visible (Definition of Done,
 * U4) — one batched load per data source (owners' defaults, item rules,
 * last-service-points, session rows), never a per-item query. An owner with
 * no defaults anywhere and no item-only rules yields an empty array, not an
 * error (every item resolves zero effective rules and is omitted).
 *
 * `visibleFirearmsAlreadyLoaded`, when supplied, is used verbatim as the
 * visible-firearm set instead of re-running `listFirearms` — see
 * `loadVisibleItems`. The name is the contract: a caller MUST pass a set
 * already filtered to the actor's own visible firearms (e.g. `listFirearms(actorId)`'s
 * result) — never an unfiltered list, which would leak cross-visibility data.
 */
export async function listDueForVisibleCollection(
  actorId: string,
  asOf: Date = new Date(),
  visibleFirearmsAlreadyLoaded?: FirearmRow[],
): Promise<ItemDueEntry[]> {
  const { firearms, accessories } = await loadVisibleItems(
    actorId,
    visibleFirearmsAlreadyLoaded,
  );
  if (firearms.length === 0 && accessories.length === 0) return [];

  const {
    firearmDefaults,
    accessoryDefaults,
    firearmRules,
    accessoryRules,
    firearmLast,
    accessoryLast,
    firearmSessions,
    accessorySessions,
  } = await loadBatchedDueData(firearms, accessories, actorId);

  const firearmEntries = firearms
    .map((fa) =>
      buildFirearmEntry(
        fa,
        firearmDefaults,
        firearmRules,
        firearmLast,
        firearmSessions,
        asOf,
      ),
    )
    .filter(isPresent);
  const accessoryEntries = accessories
    .map((acc) =>
      buildAccessoryEntry(
        acc,
        accessoryDefaults,
        accessoryRules,
        accessoryLast,
        accessorySessions,
        asOf,
      ),
    )
    .filter(isPresent);

  return [...firearmEntries, ...accessoryEntries];
}

/**
 * Parent ids (of one family) with at least one due rule, from
 * `listDueForVisibleCollection`'s output — the shared filter behind the
 * firearm and accessory list markers (R20). Firearm and accessory entries
 * are independent in `entries` (never merged), so an item due only because
 * of an accessory mounted to it never appears here on the firearm's account
 * — only the accessory's own entry does.
 */
export function dueParentIds(
  entries: ItemDueEntry[],
  parentType: ServiceParentType,
): Set<string> {
  return new Set(
    entries
      .filter(
        (entry) =>
          entry.parentType === parentType &&
          entry.rules.some((rule) => rule.due),
      )
      .map((entry) => entry.parentId),
  );
}
