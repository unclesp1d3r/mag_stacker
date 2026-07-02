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
import { user } from "./auth-schema";

/** Build a SQL `in ('a', 'b', ...)` literal list from a controlled value set. */
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
