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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACCESSORY_TYPES,
  type AccessoryType,
  ATTACHMENT_TYPES,
  type AttachmentType,
} from "../domain/accessories/constants";
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
 * - Owned parents (`firearm`, `magazine`, `ammo`) carry `owner_id` (text —
 *   Better Auth user ids are text) with an index for visibility lookups (R72).
 *   Parents use uuid PKs (R8, R64).
 * - Optional TEXT fields are NOT NULL DEFAULT '' (the empty-not-null rule, R18).
 *   Optional date/numeric fields that can be "unset" use NULL, not zero.
 * - `magazine_firearm` carries the compatibility ordinal (KTD-8) with both FKs
 *   ON DELETE CASCADE (R35) and a composite PK preventing duplicate pairs (R34).
 * - A single polymorphic `grant` table attaches to a parent by type+id and
 *   carries the permission and the create-on-behalf opt-in flag (KTD-5, R11,
 *   R61). `parent_type` has a CHECK enumerating valid parent families
 *   (`firearm`, `magazine`, `ammo`, `accessory` — the last added by #23,
 *   which reversed #8's "accessories are not independently shareable"
 *   decision); because `parent_id` cannot carry an FK,
 *   grant cleanup on item delete (R17b) runs in the same transaction as the
 *   delete in U4, with a per-parent ON DELETE trigger as a DB-layer backstop
 *   (added in the trigger migration; `ammo`'s cleanup trigger was added
 *   alongside the ammo table in migration 0010).
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
    // NFA-regulated item flag (#8). Backfills existing rows to
    // false on ADD COLUMN (R12-style).
    isNfa: boolean("is_nfa").notNull().default(false),
    // Whether this firearm takes detachable magazines (#37). Revolvers,
    // break-actions, tube-fed lever guns, and muzzleloaders are false: they are
    // excluded from magazine compatibility pickers and their magazine count
    // renders blank rather than 0. DEFAULT true IS the backfill — every existing
    // row was implicitly magazine-fed, so ADD COLUMN preserves today's behavior
    // (R1).
    isMagazineFed: boolean("is_magazine_fed").notNull().default(true),
    // NULL = unset, not zero; calendar date, no time component. Mirrors
    // `magazine.acquiredDate` / `ammo.acquiredDate` (service-intervals plan
    // R22) — it is also the origin date the service-interval day axis
    // measures from when set (KTD9 in that plan), falling back to
    // `createdAt` when null.
    acquiredDate: date("acquired_date"),
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
    // NULL = unset (not zero); calendar date, no time component.
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
 * Ammo lot (#7). The third owned parent (KTD in the ammo plan) — mirrors
 * `magazine`'s owner-scoped shape exactly. `brand`/`type`/`notes` are
 * empty-not-null (R18); `caliber` is the only required text field (R2/AS3).
 * `type` (load type — FMJ/JHP/...) is free text with UI suggestions, never a
 * controlled/CHECK-enforced set (R6) — see `domain/ammo/constants.ts`.
 * `grain`/`quantityRounds`/`lowStockThreshold` default to 0 so ADD COLUMN
 * backfills cleanly (R12-style); low-stock (`quantityRounds <= lowStockThreshold`)
 * is a derived read, never stored (R9). Deliberately excluded from
 * `inventory_log` (#46) — the log's parent-type CHECK stays
 * `('firearm', 'magazine')` (see that CHECK's comment).
 */
export const ammo = pgTable(
  "ammo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    brand: text("brand").notNull().default(""),
    caliber: text("caliber").notNull(),
    type: text("type").notNull().default(""),
    grain: integer("grain").notNull().default(0),
    quantityRounds: integer("quantity_rounds").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
    // NULL = unset (not zero); calendar date, no time component.
    acquiredDate: date("acquired_date"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("ammo_owner_id_idx").on(t.ownerId),
    // R26-style backstop — domain validation is the primary surface.
    check("ammo_grain_min", sql`${t.grain} >= 0`),
    check("ammo_quantity_min", sql`${t.quantityRounds} >= 0`),
    check("ammo_threshold_min", sql`${t.lowStockThreshold} >= 0`),
  ],
);

/**
 * Accessory (U1) — the fourth owned parent, mirroring `ammo`'s owner-scoped
 * shape. Unlike `magazine_firearm` (a many-to-many join with an ordinal), an
 * accessory mounts to at most one firearm at a time via `current_firearm_id`,
 * which is nullable (an accessory can sit unmounted in inventory) and
 * `onDelete: "set null"` — deleting a firearm unmounts its accessories rather
 * than deleting them (they remain owner inventory). `category` is the only
 * required text field (mirrors ammo's `caliber`); the rest are empty-not-null
 * (R18). `cost_cents` is nullable (unset cost is unknown, not zero) with a
 * non-negative CHECK that only bounds non-null values. `is_nfa`
 * flags NFA-regulated accessories (suppressors, SBR stocks, etc.), mirroring
 * the new `firearm.is_nfa` column.
 */
export const accessory = pgTable(
  "accessory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    currentFirearmId: uuid("current_firearm_id").references(() => firearm.id, {
      onDelete: "set null",
    }),
    // Structural discriminator (#23 R1) — controlled, required, CHECK-backed,
    // and the seam future per-type detail tables key off (KTD2). Distinct from
    // the free-text `category` below; see domain/accessories/constants.ts.
    // The `other` default exists for the backfill (R2) and keeps a direct
    // insert that predates the domain validator legal.
    type: text("type").$type<AccessoryType>().notNull().default("other"),
    // Free-text descriptive kind (#8), relaxed from required to optional
    // (#23 R3) now that `type` carries the required classification. Stays
    // NOT NULL with an empty-string default — the empty-not-null rule (R18).
    category: text("category").notNull().default(""),
    brand: text("brand").notNull().default(""),
    model: text("model").notNull().default(""),
    serialNumber: text("serial_number").notNull().default(""),
    // NULL = unset (not zero); calendar date, no time component.
    installedDate: date("installed_date"),
    // NULL = unset, not zero; calendar date, no time component. Mirrors
    // `firearm.acquiredDate` (service-intervals plan R22) — added during
    // implementation (see the plan's "Scope added during implementation"
    // note) because leaving it out reproduced R22's cold-start problem on
    // accessories: one entered today with no acquired date reads as not-due
    // on day one even when it's actually been owned for years. It is also
    // the origin date the service-interval day axis measures from when set
    // (KTD9), falling back to `createdAt` when null — `installedDate` can
    // never serve that role since it is force-nulled on unmount.
    acquiredDate: date("acquired_date"),
    costCents: integer("cost_cents"),
    notes: text("notes").notNull().default(""),
    isNfa: boolean("is_nfa").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("accessory_owner_id_idx").on(t.ownerId),
    index("accessory_current_firearm_id_idx").on(t.currentFirearmId),
    // R26-style backstop — domain validation is the primary surface. Value
    // list comes from the single source in domain/accessories/constants.ts.
    check(
      "accessory_type_valid",
      sql`${t.type} in (${sql.raw(inList(ACCESSORY_TYPES))})`,
    ),
    // R26-style backstop — domain validation is the primary surface. Nullable
    // column: the CHECK only bounds non-null cost values.
    check("accessory_cost_cents_min", sql`${t.costCents} >= 0`),
    // R6 backstop — an installed date records when the CURRENT mount began, so
    // it cannot exist without a mount. The service layer is the primary gate
    // (it forces `installedDate` to null on create/update whenever the
    // accessory is unmounted); this CHECK stops that invariant from being
    // violated by a future direct write that bypasses the service.
    check(
      "accessory_installed_date_requires_mount",
      sql`${t.installedDate} IS NULL OR ${t.currentFirearmId} IS NOT NULL`,
    ),
  ],
);

/**
 * Accessory ↔ firearm COMPATIBILITY (#23 R4/R5/R19) — "which hosts does this
 * fit", many-to-many, ordered by `ordinal`. Copies `magazine_firearm`'s shape
 * exactly (KTD3) so the two compatibility relations cannot drift.
 *
 * This is deliberately NOT the same edge as `accessory.current_firearm_id`,
 * and the two are non-redundant (KD2):
 * - `current_firearm_id` is PRESENT STATE — what this accessory is mounted on
 *   right now. Single, nullable, ON DELETE SET NULL, and the thing
 *   `installed_date` and `range_session_accessory` snapshots depend on.
 * - `accessory_firearm` (this table) is CAPABILITY — a can fits five hosts
 *   whether or not it is on any of them today. Many-to-many, ON DELETE
 *   CASCADE.
 *
 * Declaring compatibility never sets or clears the mount, and mounting never
 * touches compatibility (R6). If you are reaching for "what is this on", you
 * want the column, not this table.
 */
export const accessoryFirearm = pgTable(
  "accessory_firearm",
  {
    accessoryId: uuid("accessory_id")
      .notNull()
      .references(() => accessory.id, { onDelete: "cascade" }),
    firearmId: uuid("firearm_id")
      .notNull()
      .references(() => firearm.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    // Composite PK prevents duplicate (accessory, firearm) pairs (R19 backstop).
    primaryKey({ columns: [t.accessoryId, t.firearmId] }),
    index("accessory_firearm_firearm_id_idx").on(t.firearmId),
  ],
);

/**
 * Accessory attachment (#23 R11/R12/R13) — the mounting hardware that makes a
 * serialized accessory fit a host: mounts, pistons, end caps, muzzle devices.
 *
 * A child record in the `firearm_photo` mold (KTD7): surrogate PK, parent FK
 * ON DELETE CASCADE, and deliberately NO `owner_id` and NO grant family of its
 * own — authorization resolves through the parent accessory, so an attachment
 * can never be reachable by someone who cannot reach the accessory.
 *
 * Recording an attachment does not imply compatibility: DERIVING suggested
 * compatibility from a piston's thread pitch is explicitly deferred (#23
 * scope boundaries), so nothing here writes to `accessory_firearm`.
 */
export const accessoryAttachment = pgTable(
  "accessory_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accessoryId: uuid("accessory_id")
      .notNull()
      .references(() => accessory.id, { onDelete: "cascade" }),
    type: text("type").$type<AttachmentType>().notNull(),
    // Thread pitch / bore / whatever identifies the part — free text, and
    // empty-not-null like every other optional text field (R18).
    spec: text("spec").notNull().default(""),
    serialNumber: text("serial_number").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("accessory_attachment_accessory_id_idx").on(t.accessoryId),
    // R26-style backstop — domain validation is the primary surface.
    check(
      "accessory_attachment_type_valid",
      sql`${t.type} in (${sql.raw(inList(ATTACHMENT_TYPES))})`,
    ),
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
 * a future consumption/"consume rounds" feature (not yet filed) and intentionally
 * carries NO FK even though the `ammo` table now exists (KTD5) — that linkage is
 * out of scope for the ammo-inventory slice (no round deduction, no reservation).
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
    // Nullable consumption seam — intentionally FK-less even though `ammo` now exists (KTD5).
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

/**
 * Range session ↔ accessory linkage (U7) — the only mount history v1 keeps
 * (R19): when a session is created, the firearm's currently-mounted
 * accessories are snapshotted into this join so per-accessory rounds fired
 * can be derived later. Unlike `magazine_firearm`'s composite PK, this table
 * uses a surrogate `id` PK because `accessory_id` must be nullable — deleting
 * an accessory (`ON DELETE SET NULL`) leaves the session's linkage row intact
 * with a null reference rather than deleting it, so the session's snapshot
 * history survives the accessory's deletion. `range_session_id` is
 * `ON DELETE CASCADE` (the join is a child of the session, R35-style). The
 * unique constraint on (range_session_id, accessory_id) prevents duplicate
 * snapshot rows for the same session/accessory pair; both columns are also
 * indexed individually for the per-session and per-accessory lookups.
 */
export const rangeSessionAccessory = pgTable(
  "range_session_accessory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rangeSessionId: uuid("range_session_id")
      .notNull()
      .references(() => rangeSession.id, { onDelete: "cascade" }),
    accessoryId: uuid("accessory_id").references(() => accessory.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    unique("range_session_accessory_unique").on(
      t.rangeSessionId,
      t.accessoryId,
    ),
    index("range_session_accessory_session_id_idx").on(t.rangeSessionId),
    index("range_session_accessory_accessory_id_idx").on(t.accessoryId),
  ],
);

/**
 * Firearm photo (#9) — a firearm child record (R62), mirroring `rangeSession`'s
 * shape: no `owner_id`, no own grant family — every read/write authorizes
 * through the parent firearm (R6). The FK ON DELETE CASCADE drops photo rows
 * with the firearm; blob cleanup for the underlying storage objects is handled
 * separately in the delete flow (U5), not by this table. `storageKey` is the
 * server-generated key for the original blob; derivatives (thumbnail/preview)
 * are addressable via a deterministic convention derived from that key (R5) —
 * no separate derivative table or manifest column. `caption` is
 * empty-not-null (R18). `uploadedAt` is a single timestamp column (not
 * `createdAt`/`updatedAt` — photos aren't mutated in place beyond caption/sort/
 * primary, and `uploadedAt` is the field the product surfaces).
 */
export const firearmPhoto = pgTable(
  "firearm_photo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firearmId: uuid("firearm_id")
      .notNull()
      .references(() => firearm.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // Empty-not-null (R18).
    caption: text("caption").notNull().default(""),
    sortOrder: integer("sort_order").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [
    // Per-firearm gallery lookup.
    index("firearm_photo_firearm_id_idx").on(t.firearmId),
    // R26-style backstop — domain validation is the primary surface (KTD4).
    check("firearm_photo_sort_order_min", sql`${t.sortOrder} >= 0`),
    // DB backstop for the upload allow-list (R9): a direct insert bypassing the
    // app layer (migration, admin tool, import script) can't write a MIME type
    // outside the controlled set the serving route echoes as Content-Type. The
    // literal list must stay in sync with `ALLOWED_MIME_TYPES`
    // (`src/domain/firearm-photos/constants.ts`) — SQL can't import the TS
    // constant, so this is a deliberate third copy alongside the raster-format
    // set derived there.
    check(
      "firearm_photo_mime_type_valid",
      sql`${t.mimeType} in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')`,
    ),
    // Positivity backstops (KTD4): the pipeline already guarantees decoded
    // dimensions and a non-empty upload, mirroring the quantity CHECKs on
    // sibling inventory tables.
    check("firearm_photo_size_bytes_min", sql`${t.sizeBytes} > 0`),
    check("firearm_photo_width_min", sql`${t.width} > 0`),
    check("firearm_photo_height_min", sql`${t.height} > 0`),
    // DB backstop (R7): at most one primary photo per firearm. A partial
    // unique index (only rows where `is_primary` is true) rather than a plain
    // unique constraint on `(firearm_id, is_primary)`, which would also
    // forbid more than one NON-primary row per firearm. `setPrimary` clears
    // the old primary then sets the new one inside one transaction — both the
    // intermediate all-false state and the final single-true state satisfy
    // this index — and `createPhotos` sets `is_primary` on at most the first
    // photo of a batch, so neither normal flow can violate it.
    uniqueIndex("firearm_photo_one_primary_per_firearm")
      .on(t.firearmId)
      .where(sql`${t.isPrimary}`),
  ],
);

/**
 * Firearm document (#12) — a firearm child record, mirroring `firearmPhoto`'s
 * child-record shape (no `owner_id`, no own grant family) but authorizing
 * OWNER-ONLY on every operation (KTD1) rather than inheriting the firearm's
 * grants like photos do. Documents are receipts/warranties/ATF forms/manuals/
 * insurance — highly sensitive PII kept verbatim off the image pipeline (a
 * single blob, no derivatives/width/height/primary/sort/caption). The FK ON
 * DELETE CASCADE drops rows with the firearm; blob cleanup is handled eagerly
 * in `deleteFirearm`'s pre-delete hook (R19), never left to the bare cascade.
 * `filename` is the sanitized original name (R3); `docType` is a controlled set
 * defaulting to 'other' (R2); `notes` is empty-not-null. Both `filename` and
 * `notes` are PII-bearing (inputs to #67's encryption-at-rest evaluation, KTD8).
 */
export const firearmDocument = pgTable(
  "firearm_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firearmId: uuid("firearm_id")
      .notNull()
      .references(() => firearm.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    // Sanitized original filename (R3) — also the download filename.
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Controlled docType set (R2); defaults to 'other'.
    docType: text("doc_type").notNull().default("other"),
    // Empty-not-null free-text notes.
    notes: text("notes").notNull().default(""),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [
    // Per-firearm document-list lookup (ordered most-recent-first in the domain).
    index("firearm_document_firearm_id_idx").on(t.firearmId),
    // DB backstop for the upload allow-list (R5): a direct insert bypassing the
    // app layer can't write a MIME type outside the controlled set. Documents
    // add application/pdf to the photo raster set. The literal list must stay in
    // sync with `ALLOWED_MIME_TYPES` (`src/domain/firearm-documents/
    // constants.ts`) — SQL can't import the TS constant.
    check(
      "firearm_document_mime_type_valid",
      sql`${t.mimeType} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/avif')`,
    ),
    // DB backstop for the controlled docType set (R2) — must stay in sync with
    // `DOC_TYPES` (`src/domain/firearm-documents/constants.ts`).
    check(
      "firearm_document_doc_type_valid",
      sql`${t.docType} in ('receipt', 'warranty', 'atf-form-1', 'atf-form-4', 'manual', 'insurance', 'other')`,
    ),
    // Positivity backstop (mirrors the sibling inventory quantity CHECKs).
    check("firearm_document_size_bytes_min", sql`${t.sizeBytes} > 0`),
  ],
);

/**
 * Service rule default (service-intervals plan, U1) — an owner-scoped default
 * rule set keyed by category: `scope` is `'firearm'` (category = firearm
 * `type`) or `'accessory'` (category = accessory `category` as typed, KD10).
 * `unique(owner_id, scope, category, name)` prevents two default rules
 * sharing a name within one owner's category (R2). At least one of the three
 * thresholds must be non-null (R2) and every non-null threshold must be >= 1
 * (R26-style backstop) — enforced by the two CHECKs below rather than one
 * combined expression, so a failure names which invariant broke. No FK to
 * `firearm`/`accessory`: a default's category is a value, not a reference
 * (KTD8 — the accessory-category list itself is derived on read, never
 * stored here).
 */
export const serviceRuleDefault = pgTable(
  "service_rule_default",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    // Nullable thresholds (unset means "not tracked on this axis", not
    // zero). At least one must be set — see the CHECK below.
    intervalDays: integer("interval_days"),
    intervalSessions: integer("interval_sessions"),
    intervalRounds: integer("interval_rounds"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("service_rule_default_owner_id_idx").on(t.ownerId),
    unique("service_rule_default_owner_scope_category_name_unique").on(
      t.ownerId,
      t.scope,
      t.category,
      t.name,
    ),
    check(
      "service_rule_default_scope_valid",
      sql`${t.scope} in ('firearm', 'accessory')`,
    ),
    check(
      "service_rule_default_has_threshold",
      sql`num_nonnulls(${t.intervalDays}, ${t.intervalSessions}, ${t.intervalRounds}) >= 1`,
    ),
    check(
      "service_rule_default_thresholds_min",
      sql`(${t.intervalDays} IS NULL OR ${t.intervalDays} >= 1) AND (${t.intervalSessions} IS NULL OR ${t.intervalSessions} >= 1) AND (${t.intervalRounds} IS NULL OR ${t.intervalRounds} >= 1)`,
    ),
  ],
);

/**
 * Service rule (service-intervals plan, U1) — a per-item rule row attached to
 * a firearm or an accessory through two nullable FKs with an exactly-one
 * CHECK (KTD2), rather than the `parent_type`/`parent_id` shape `grant` and
 * `inventory_log` use. Real FKs give native `ON DELETE CASCADE`, so no
 * hand-written cleanup trigger (of the kind `0002_grant_cleanup_triggers.sql`
 * / `0008_brown_bulldozer.sql` carry) is needed here. A row is one of three
 * things (KTD6): an override (thresholds set, not suppressed), a suppression
 * (`suppressed = true`, no thresholds — suppressing and restoring is
 * inserting/deleting this row, not toggling a separate flag), or an
 * item-only rule with no matching default (also thresholds set, not
 * suppressed — indistinguishable at the row level from an override; that
 * distinction is resolved against the defaults set in the domain layer, not
 * stored). `unique(firearm_id, name)` / `unique(accessory_id, name)` rely on
 * Postgres treating NULLs as distinct, so a firearm rule and an accessory
 * rule never collide with each other even when they share a name. Exactly
 * one parent, never zero or both: a row with neither FK set would be a
 * meaningless orphan, and one with both would mean a single rule belongs to
 * two items at once — incoherent alongside those same per-parent unique
 * constraints, which only make sense scoped to one item apiece.
 */
export const serviceRule = pgTable(
  "service_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firearmId: uuid("firearm_id").references(() => firearm.id, {
      onDelete: "cascade",
    }),
    accessoryId: uuid("accessory_id").references(() => accessory.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    intervalDays: integer("interval_days"),
    intervalSessions: integer("interval_sessions"),
    intervalRounds: integer("interval_rounds"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("service_rule_firearm_id_idx").on(t.firearmId),
    index("service_rule_accessory_id_idx").on(t.accessoryId),
    unique("service_rule_firearm_name_unique").on(t.firearmId, t.name),
    unique("service_rule_accessory_name_unique").on(t.accessoryId, t.name),
    check(
      "service_rule_exactly_one_parent",
      sql`num_nonnulls(${t.firearmId}, ${t.accessoryId}) = 1`,
    ),
    check(
      "service_rule_thresholds_min",
      sql`(${t.intervalDays} IS NULL OR ${t.intervalDays} >= 1) AND (${t.intervalSessions} IS NULL OR ${t.intervalSessions} >= 1) AND (${t.intervalRounds} IS NULL OR ${t.intervalRounds} >= 1)`,
    ),
    // Suppressed rows carry no thresholds; unsuppressed rows carry at least
    // one (approach step 2) — the same shape rule the defaults table
    // enforces, plus the suppression/threshold exclusivity.
    check(
      "service_rule_suppressed_thresholds_consistent",
      sql`(${t.suppressed} AND num_nonnulls(${t.intervalDays}, ${t.intervalSessions}, ${t.intervalRounds}) = 0) OR (NOT ${t.suppressed} AND num_nonnulls(${t.intervalDays}, ${t.intervalSessions}, ${t.intervalRounds}) >= 1)`,
    ),
  ],
);

/**
 * Service event (service-intervals plan, U1) — one logged act of service
 * against a named rule on a firearm or an accessory, same exactly-one-parent
 * shape as `service_rule` (KTD2) and the same reason for it: a row belongs to
 * one item's history, never zero (an orphan event nothing can display) and
 * never two (an event can't have happened to two separate items).
 * `rule_name` is a plain text column, not an
 * FK to `service_rule` (KTD1): a rule's identity is its name, and an event
 * must be able to exist (via the U5 `cleaned`/`lubed` conversion) without a
 * corresponding rule row ever having been created, so renaming an item rule
 * re-points its events' `rule_name` in the same transaction rather than
 * following a reference. `serviced_on` is a calendar `date` (KTD5 — compared
 * as a calendar day, never an instant); `created_at` is a separate
 * not-null-defaulted timestamp so several rules serviced on the same
 * calendar day still sort in a stable insertion order, and so the R15
 * conversion has somewhere to carry the source `inventory_log` row's
 * insertion time. `actor_id` FKs to `user` with `ON DELETE SET NULL` —
 * mirroring `inventory_log.actorId`'s reasoning: the event is a child of its
 * parent item (already cleaned up by the FK cascade above), not of the
 * actor, so deleting a user account must never be blocked by service events
 * that user logged against someone else's shared item.
 */
export const serviceEvent = pgTable(
  "service_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firearmId: uuid("firearm_id").references(() => firearm.id, {
      onDelete: "cascade",
    }),
    accessoryId: uuid("accessory_id").references(() => accessory.id, {
      onDelete: "cascade",
    }),
    ruleName: text("rule_name").notNull(),
    servicedOn: date("serviced_on").notNull(),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Empty-not-null (R18-style).
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("service_event_firearm_id_idx").on(t.firearmId),
    index("service_event_accessory_id_idx").on(t.accessoryId),
    // Latest-service-point lookup per item and rule name (grouped `max`,
    // mirroring `loadLastInventoriedBatch`'s query shape).
    index("service_event_firearm_rule_serviced_idx").on(
      t.firearmId,
      t.ruleName,
      t.servicedOn,
    ),
    index("service_event_accessory_rule_serviced_idx").on(
      t.accessoryId,
      t.ruleName,
      t.servicedOn,
    ),
    check(
      "service_event_exactly_one_parent",
      sql`num_nonnulls(${t.firearmId}, ${t.accessoryId}) = 1`,
    ),
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
      sql`${t.parentType} in ('firearm', 'magazine', 'ammo', 'accessory')`,
    ),
    check("grant_permission_valid", sql`${t.permission} in ('view', 'edit')`),
  ],
);

/**
 * Inventory event log (U2/U3) — an append-only audit trail of actions taken
 * against a firearm or magazine (`inventoried`, the only event type either
 * parent family carries — `cleaned` and `lubed` were retired and converted to
 * `service_event` rows by the service-intervals plan's U5). Polymorphic
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
