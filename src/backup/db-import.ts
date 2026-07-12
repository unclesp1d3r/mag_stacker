import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../db/client";
import type { ExportedRow } from "./db-export";
import { EXPORT_TABLE_ORDER, WIPE_TABLE_ORDER } from "./table-order";

const TABLES_BY_NAME: ReadonlyMap<string, PgTable> = new Map(
  EXPORT_TABLE_ORDER.map((table) => [getTableName(table), table]),
);

/**
 * JS property keys (not SQL column names) on `table` whose values are
 * date/timestamp columns. Cached per table by `importDatabase` since the same
 * table appears across many NDJSON lines.
 */
function dateColumnKeys(table: PgTable): readonly string[] {
  const columns = getTableColumns(table);
  return Object.entries(columns)
    .filter(([, column]) => column.dataType === "date")
    .map(([key]) => key);
}

/**
 * Revive a row parsed back out of NDJSON: `JSON.stringify` turns every `Date`
 * into an ISO string, but Drizzle's date/timestamp columns call
 * `value.toISOString()` on write (`mapToDriverValue`) — handing them a plain
 * string throws. Returns a new object; never mutates `row` (immutability).
 */
function reviveRow(
  row: Record<string, unknown>,
  dateKeys: readonly string[],
): Record<string, unknown> {
  if (dateKeys.length === 0) return row;
  const revived: Record<string, unknown> = { ...row };
  for (const key of dateKeys) {
    const value = revived[key];
    if (typeof value === "string") {
      revived[key] = new Date(value);
    }
  }
  return revived;
}

/**
 * Import an NDJSON export produced by `exportDatabase` (U3, R5/R10).
 *
 * Reads the stream line by line (never buffering the whole file) and inserts
 * each row inside ONE transaction, so a failure partway through — a parse
 * error, an unknown table, a constraint violation — rolls back every row
 * already inserted rather than leaving a half-restored database. Insert order
 * is whatever order the file already carries its rows in: `exportDatabase`
 * always writes tables in `EXPORT_TABLE_ORDER` (FK-safe), so import trusts
 * that order instead of re-sorting or buffering the file to re-derive it.
 *
 * Refuse-unless-empty, force-replace, and version-compatibility checks are
 * the caller's job (a later restore-flow unit) — this function is the raw
 * insert primitive only.
 */
export async function importDatabase(
  db: Database,
  stream: Readable,
): Promise<void> {
  await db.transaction(async (tx) => {
    const dateKeyCache = new Map<string, readonly string[]>();
    const lines = createInterface({
      input: stream,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    for await (const line of lines) {
      if (line.trim() === "") continue;

      const parsed = JSON.parse(line) as ExportedRow;
      const table = TABLES_BY_NAME.get(parsed.table);
      if (!table) {
        throw new Error(
          `Backup references unknown table "${parsed.table}" — it isn't in EXPORT_TABLE_ORDER (src/backup/table-order.ts). Refusing to import a row this build doesn't know how to place.`,
        );
      }

      let dateKeys = dateKeyCache.get(parsed.table);
      if (!dateKeys) {
        dateKeys = dateColumnKeys(table);
        dateKeyCache.set(parsed.table, dateKeys);
      }

      await insertRow(tx, table, reviveRow(parsed.row, dateKeys));
    }
  });
}

/**
 * `TABLES_BY_NAME` is deliberately heterogeneous (every persistent table),
 * and the row shape is only known at runtime — from the NDJSON line itself —
 * so this is the one place `.insert()` loses its concrete row type.
 */
async function insertRow(
  tx: Transaction,
  table: PgTable,
  row: Record<string, unknown>,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: see function doc comment.
  await tx.insert(table as any).values(row);
}

/**
 * Delete every row from every persistent table, in FK-safe reverse-insert
 * order (`WIPE_TABLE_ORDER`), inside one transaction. This is the primitive a
 * force-replace restore uses to clear existing data before applying a bundle
 * (R7) — it does not itself implement the refuse-unless-empty guard or the
 * snapshot/rollback safety net around it; those are the caller's job.
 */
export async function wipeDatabase(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of WIPE_TABLE_ORDER) {
      await deleteAllRows(tx, table);
    }
  });
}

/** See `insertRow`'s doc comment — same reason, for `.delete()`. */
async function deleteAllRows(tx: Transaction, table: PgTable): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: see insertRow's doc comment.
  await tx.delete(table as any);
}
