import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Operator audit trail (U3, R15 — encryption-at-rest backups plan).
 *
 * Append-only record of admin-run backup export/restore actions: who ran it
 * (`actor` — the acting user id or email), what they ran (`action`), and how
 * it turned out (`outcome`, e.g. "success"/"failure"/"refused"). Deliberately
 * carries NO FK to `user`: an audit row must outlive the account that
 * produced it (account deletion must never delete or block on its own audit
 * trail), and `actor` may record an email rather than a live user id. `at`
 * defaults to the write time; the row is never updated after insert.
 */
export const operatorAudit = pgTable(
  "operator_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Chronological audit lookup.
    index("operator_audit_at_idx").on(t.at),
    // R26-style backstop — domain validation is the primary surface.
    check(
      "operator_audit_action_valid",
      sql`${t.action} in ('export', 'restore')`,
    ),
  ],
);
