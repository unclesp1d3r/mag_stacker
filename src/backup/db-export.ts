import { Readable } from "node:stream";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DbOrTx } from "../db/client";
import { EXPORT_TABLE_ORDER } from "./table-order";

/** One NDJSON line: a table name plus the raw row it names. */
export interface ExportedRow {
  table: string;
  row: Record<string, unknown>;
}

/**
 * Export the full database as NDJSON (U3, R2/R13) — one JSON line per row,
 * each tagged with its table name, in FK-safe insert order
 * (`EXPORT_TABLE_ORDER`). Ephemeral tables (session, rate-limit, idempotency)
 * are never touched — they simply aren't in that list.
 *
 * Returned as a Node `Readable` so a caller can pipe it straight into an
 * encryption/archive stage without buffering the whole export in memory: each
 * table's rows are fetched and yielded table-by-table (not held alongside
 * every other table's rows at once), and the generator only pulls the next
 * table once the consumer has drained the current one.
 */
export function exportDatabase(db: DbOrTx): Readable {
  async function* generate(): AsyncGenerator<string> {
    for (const table of EXPORT_TABLE_ORDER) {
      const tableName = getTableName(table);
      const rows = await selectAllRows(db, table);
      for (const row of rows) {
        yield `${JSON.stringify({ table: tableName, row } satisfies ExportedRow)}\n`;
      }
    }
  }

  return Readable.from(generate());
}

/**
 * `EXPORT_TABLE_ORDER` is deliberately heterogeneous (every persistent
 * table), so this is the one place `.from()` loses its concrete row type —
 * every row coming out of it is an opaque bag of columns anyway, which is all
 * `exportDatabase` needs.
 */
async function selectAllRows(
  db: DbOrTx,
  table: PgTable,
): Promise<Record<string, unknown>[]> {
  // biome-ignore lint/suspicious/noExplicitAny: see function doc comment.
  const rows = await db.select().from(table as any);
  return rows as Record<string, unknown>[];
}
