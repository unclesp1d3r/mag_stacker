import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  FIREARM_ACTIONS,
  FIREARM_TYPES,
  UNSPECIFIED,
} from "../domain/firearms/constants";
import {
  FIREARM_LOG_EVENTS,
  MAGAZINE_LOG_EVENTS,
} from "../domain/inventory-log/constants";
import { user } from "./auth-schema";

/**
 * Build a SQL `in ('a', 'b', ...)` literal list from a controlled value set.
 * Values are quoted naively (no escaping) — only ever call this with fixed,
 * code-defined constant arrays (e.g. FIREARM_TYPES), never request/DB-sourced
 * data, or a value containing a single quote would corrupt the DDL.
 */
function inList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(", ");
}

/**
 * Inventory + sharing schema (U3).
 *
 * Shape notes:
 * - Owned parents (`firearm`, `magazine`) carry `owner_id` (text — Better Auth
 *   user ids are text) with an index for visibility lookups (R72). Parents use
 *   uuid PKs (R8, R64).
 * - Optional TEXT fields are NOT NULL DEFAULT '' (the empty-not-null rule, R18).
 *   Optional date/numeric fields that can be "unset" use NULL (KTD-7).
 * - `magazine_firearm` carries the compatibility ordinal (KTD-8) with both FKs
 *   ON DELETE CASCADE (R35) and a composite PK preventing duplicate pairs (R34).
 * - A single polymorphic `grant` table attaches to a parent by type+id and
 *   carries the permission and the create-on-behalf opt-in flag (KTD-5, R11,
 *   R61). `parent_type` has a CHECK enumerating valid parent families; because
 *   `parent_id` cannot carry an FK, grant cleanup on item delete (R17b) runs in
 *   the same transaction as the delete in U4, with a per-parent ON DELETE
 *   trigger as a DB-layer backstop (added in the trigger migration).
 * - `idempotency` holds `(user_id, idempotency_key)` unique with the stored
 *   result and an expiry (R69, used by U10/U12).
 *
 * Child-record seam (R62): future child families reference their parent and
 * inherit owner/grants. No child tables exist yet; the parent shape above is
 * what they follow.
 */

export const firearm = pgTable(
  "firearm",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Optional owner nickname distinct from the canonical product name (#18).
    // Empty-not-null (R18); ADD COLUMN backfills existing rows to '' (R12).
    nickname: text("nickname").notNull().default(""),
    manufacturer: text("manufacturer").notNull().default(""),
    caliber: text("caliber").notNull(),
    // Controlled taxonomy (U2). NOT NULL DEFAULT 'unspecified' backfills existing
    // rows on ADD COLUMN (R12); domain validation rejects 'unspecified' on write
    // (R7). `subtype` is optional free text (empty-not-null, R18).
    type: text("type").notNull().default(UNSPECIFIED),
    action: text("action").notNull().default(UNSPECIFIED),
    subtype: text("subtype").notNull().default(""),
    serialNumber: text("serial_number").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("firearm_owner_id_idx").on(t.ownerId),
    // R26 backstop — domain validation is the primary surface. Value lists come
    // from the single source in domain/firearms/constants.ts (KTD-A).
    check(
      "firearm_type_valid",
      sql`${t.type} in (${sql.raw(inList(FIREARM_TYPES))})`,
    ),
    check(
      "firearm_action_valid",
      sql`${t.action} in (${sql.raw(inList(FIREARM_ACTIONS))})`,
    ),
  ],
);

export const magazine = pgTable(
  "magazine",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    brandModel: text("brand_model").notNull(),
    caliber: text("caliber").notNull(),
    baseCapacity: integer("base_capacity").notNull(),
    extensionRounds: integer("extension_rounds").notNull().default(0),
    label: text("label").notNull().default(""),
    // NULL = unset (KTD-7); calendar date, no time component.
    acquiredDate: date("acquired_date"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("magazine_owner_id_idx").on(t.ownerId),
    // R26 backstop — domain validation is the primary surface.
    check("magazine_base_capacity_min", sql`${t.baseCapacity} >= 1`),
    check("magazine_extension_rounds_min", sql`${t.extensionRounds} >= 0`),
  ],
);

/**
 * Per-owner label-prefix list (#22). A flat set of prefix strings the owner has
 * used, extended on create (single or bulk). Feeds the single-add prefix
 * combobox and drives auto-numbering; the composite PK enforces one row per
 * (owner, prefix) and its leading `owner_id` column serves owner-scoped lookups,
 * so no separate index is needed. Grows-only in v1 (no delete/rename path).
 */
export const magazineLabelPrefix = pgTable(
  "magazine_label_prefix",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.prefix] })],
);

export const magazineFirearm = pgTable(
  "magazine_firearm",
  {
    magazineId: uuid("magazine_id")
      .notNull()
      .references(() => magazine.id, { onDelete: "cascade" }),
    firearmId: uuid("firearm_id")
      .notNull()
      .references(() => firearm.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    // Composite PK prevents duplicate (magazine, firearm) pairs (R34 backstop).
    primaryKey({ columns: [t.magazineId, t.firearmId] }),
    index("magazine_firearm_firearm_id_idx").on(t.firearmId),
  ],
);

/**
 * Range session log (#11) — the first firearm child record (R62). One row per
 * firearm per range trip; a firearm's lifetime round total is DERIVED by summing
 * `rounds_fired` over its rows (no stored counter). Inherits owner/grants from
 * the parent firearm: no `owner_id`, no own grant family. The FK ON DELETE
 * CASCADE drops sessions with the firearm (R35). `ammo_id` is a nullable seam for
 * the future Ammo inventory (#7) and intentionally carries NO FK — the ammo table
 * does not exist yet (KTD5).
 */
export const rangeSession = pgTable(
  "range_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firearmId: uuid("firearm_id")
      .notNull()
      .references(() => firearm.id, { onDelete: "cascade" }),
    // Calendar date of the session, no time component.
    date: date("date").notNull(),
    roundsFired: integer("rounds_fired").notNull(),
    // Nullable #7 seam — no FK until the ammo table exists (KTD5).
    ammoId: uuid("ammo_id"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Per-firearm history + lifetime-total aggregation lookup.
    index("range_session_firearm_id_idx").on(t.firearmId),
    // R26-style backstop — domain validation is the primary surface (KTD4).
    check("range_session_rounds_fired_min", sql`${t.roundsFired} >= 1`),
  ],
);

export const grant = pgTable(
  "grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    granteeId: text("grantee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentType: text("parent_type").notNull(),
    parentId: uuid("parent_id").notNull(),
    permission: text("permission").notNull(),
    allowCreateOnBehalf: boolean("allow_create_on_behalf")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One grant per grantee per item; re-granting updates it (U4 upsert).
    unique("grant_grantee_parent_unique").on(
      t.granteeId,
      t.parentType,
      t.parentId,
    ),
    // Visibility lookup index (R72).
    index("grant_grantee_parent_type_idx").on(t.granteeId, t.parentType),
    check(
      "grant_parent_type_valid",
      sql`${t.parentType} in ('firearm', 'magazine')`,
    ),
    check("grant_permission_valid", sql`${t.permission} in ('view', 'edit')`),
  ],
);

/**
 * Inventory event log (U2/U3) — an append-only audit trail of actions taken
 * against a firearm or magazine (inventoried, cleaned, lubed). Polymorphic
 * `parent_type`/`parent_id` mirrors `grant`: no FK on `parent_id` (it spans
 * two parent tables), with a `parent_type` CHECK plus a parent-gated
 * `event_type` CHECK sourced from `domain/inventory-log/constants.ts` (R3
 * backstop; the domain validator is the primary gate). `actor_id` FKs to
 * `user` with `onDelete: "set null"` — the log row is a child of its parent
 * ITEM (already cleaned up by the parent-delete trigger below), not of the
 * actor, so deleting a user account must never be blocked by entries that
 * user authored on someone else's shared item. `actor_id` is always supplied
 * at write time (never null on insert — `createLogEntry` always passes the
 * acting user's id); it is only set to NULL later, if that actor's account
 * is subsequently deleted, which preserves the owner's audit entry with
 * degraded attribution rather than deleting it or blocking the user delete.
 * Rows are cleaned up via a parent-delete cascade trigger (added by hand in
 * the generated migration), matching the `grant` cleanup pattern, since
 * `parent_id` cannot carry an FK (R13).
 */
export const inventoryLog = pgTable(
  "inventory_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentType: text("parent_type").notNull(),
    parentId: uuid("parent_id").notNull(),
    eventType: text("event_type").notNull(),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    // Empty-not-null (R5).
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Newest-first per-item lookup (parent, then recency).
    index("inventory_log_parent_idx").on(
      t.parentType,
      t.parentId,
      t.occurredAt,
    ),
    check(
      "inventory_log_parent_type_valid",
      sql`${t.parentType} in ('firearm', 'magazine')`,
    ),
    // R3 backstop — domain validation is the primary surface. Value lists
    // come from the single source in domain/inventory-log/constants.ts.
    check(
      "inventory_log_event_type_valid",
      sql`(${t.parentType} = 'firearm' AND ${t.eventType} in (${sql.raw(inList(FIREARM_LOG_EVENTS))})) OR (${t.parentType} = 'magazine' AND ${t.eventType} in (${sql.raw(inList(MAGAZINE_LOG_EVENTS))}))`,
    ),
  ],
);

export const idempotency = pgTable(
  "idempotency",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    result: jsonb("result"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Atomic insert-conflict target — the per-user dedup key (R69, KTD-9).
    primaryKey({ columns: [t.userId, t.idempotencyKey] }),
    index("idempotency_expires_at_idx").on(t.expiresAt),
  ],
);
