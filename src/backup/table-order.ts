import type { PgTable } from "drizzle-orm/pg-core";
import { account, user, verification } from "../db/auth-schema";
import {
  accessory,
  ammo,
  firearm,
  firearmDocument,
  firearmPhoto,
  grant,
  inventoryLog,
  magazine,
  magazineFirearm,
  magazineLabelPrefix,
  rangeSession,
  rangeSessionAccessory,
} from "../db/inventory-schema";
import { operatorAudit } from "../db/operator-audit-schema";

/**
 * FK-safe insert order for EVERY persistent table in the database (U3).
 *
 * New tables MUST be added here or they are silently dropped from backups.
 *
 * Order rationale:
 * - `user` is the root parent everything else (directly or transitively)
 *   depends on; `verification` and `account` are the remaining auth tables
 *   that persist across restarts (`account` FKs to `user`).
 * - The four owned inventory parents (`firearm`, `magazine`, `ammo`,
 *   `accessory`) FK to `user`. `accessory` additionally holds a nullable FK to
 *   `firearm` (its optional current mount), so it must come after `firearm`.
 * - `magazine_label_prefix` FKs to `user` only.
 * - The remaining tables are children of the parents above and are ordered so
 *   every FK target has already been inserted: `magazine_firearm` (magazine +
 *   firearm), `range_session` (firearm), `range_session_accessory`
 *   (range_session + accessory), `firearm_photo` (firearm), `firearm_document`
 *   (firearm).
 * - `grant` and `inventory_log` FK to `user` only (their polymorphic
 *   `parent_id` carries no FK — see the schema doc comments) so they can sit
 *   anywhere after `user`; placed last among inventory tables since they
 *   logically depend on the items they reference existing first.
 * - `operator_audit` has no FK to anything and is appended last.
 */
export const EXPORT_TABLE_ORDER: readonly PgTable[] = [
  user,
  verification,
  account,
  firearm,
  magazine,
  ammo,
  accessory,
  magazineLabelPrefix,
  magazineFirearm,
  rangeSession,
  rangeSessionAccessory,
  firearmPhoto,
  firearmDocument,
  grant,
  inventoryLog,
  operatorAudit,
];

/**
 * Insert order in reverse — the FK-safe order to WIPE tables before a
 * force-replace restore (children before the parents they reference).
 */
export const WIPE_TABLE_ORDER: readonly PgTable[] = [
  ...EXPORT_TABLE_ORDER,
].reverse();

/**
 * Ephemeral tables intentionally excluded from every backup: session state,
 * the DB-stored rate-limit counters, and the short-lived idempotency dedup
 * store. None of these belong in a restored instance — restoring them would
 * either resurrect stale sessions/rate-limit windows or reintroduce
 * already-expired dedup rows.
 */
export const EPHEMERAL_TABLE_NAMES: readonly string[] = [
  "session",
  "rate_limit",
  "idempotency",
];
