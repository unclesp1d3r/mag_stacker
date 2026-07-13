import type { Readable } from "node:stream";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../db/client";
import type { ExportedRow } from "./db-export";
import { EXPORT_TABLE_ORDER, WIPE_TABLE_ORDER } from "./table-order";

const TABLES_BY_NAME: ReadonlyMap<string, PgTable> = new Map(
  EXPORT_TABLE_ORDER.map((table) => [getTableName(table), table]),
);

const NEWLINE_BYTE = 0x0a; // "\n"

/**
 * Hard ceiling on a single NDJSON line's byte length before import refuses to
 * read any more of it. A restore bundle is admin-uploaded, but its content is
 * still untrusted (corrupted download, or a deliberately crafted bundle) —
 * without a bound, one enormous unterminated line would buffer without limit
 * in memory before `JSON.parse` ever ran (a memory-exhaustion vector). The
 * largest legitimate line here is one row of inventory JSON — a handful of
 * scalar/UUID/timestamp columns, never a blob (blob content lives as its own
 * bundle entry, never inline in `db.ndjson`) — so a real row is a few KiB at
 * most. 8 MiB is generous headroom above that while still being a finite,
 * enforced ceiling.
 */
export const MAX_NDJSON_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Reads `stream` as NDJSON lines (`\n`-terminated; a trailing `\r` is
 * trimmed so CRLF-terminated files still work), bounding how many bytes may
 * accumulate for a single line before a newline is seen. Reads whatever
 * chunks the underlying stream delivers and checks the running total after
 * each one, so a line is rejected — via `MAX_NDJSON_LINE_BYTES` above — as
 * soon as it crosses the cap, before the offending line is ever fully
 * buffered or handed to `JSON.parse`. Throwing mid-iteration lets
 * `for await...of`'s built-in cleanup (calling the async iterator's
 * `return()`) close/destroy the source stream.
 */
async function* readBoundedLines(
  stream: Readable,
  maxLineBytes: number,
): AsyncGenerator<string> {
  // Typed as `Buffer<ArrayBufferLike>` (not the narrower default
  // `Buffer<ArrayBuffer>`) because `Readable`'s async-iterator chunks and
  // `Buffer.from()`'s overload resolution on them both carry that wider,
  // more permissive generic.
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  for await (const rawChunk of stream) {
    const chunk: Buffer<ArrayBufferLike> = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk);
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    let newlineIndex = pending.indexOf(NEWLINE_BYTE);
    while (newlineIndex !== -1) {
      yield decodeLine(pending.subarray(0, newlineIndex));
      pending = pending.subarray(newlineIndex + 1);
      newlineIndex = pending.indexOf(NEWLINE_BYTE);
    }

    if (pending.length > maxLineBytes) {
      throw new Error(
        `Backup's db.ndjson contains a line longer than ${maxLineBytes} bytes (no newline found) — refusing to import; this may be a corrupted or malicious bundle.`,
      );
    }
  }

  if (pending.length > 0) {
    if (pending.length > maxLineBytes) {
      throw new Error(
        `Backup's db.ndjson ends with a line longer than ${maxLineBytes} bytes — refusing to import; this may be a corrupted or malicious bundle.`,
      );
    }
    yield decodeLine(pending);
  }
}

function decodeLine(buffer: Buffer<ArrayBufferLike>): string {
  const text = buffer.toString("utf8");
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

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
 * Reads the stream line by line (never buffering the whole file, and never
 * buffering a single line past `MAX_NDJSON_LINE_BYTES` — see
 * `readBoundedLines`) and inserts each row inside ONE transaction, so a
 * failure partway through — a parse error, an unknown table, a constraint
 * violation, an oversized line — rolls back every row already inserted
 * rather than leaving a half-restored database. Insert order is whatever
 * order the file already carries its rows in: `exportDatabase` always writes
 * tables in `EXPORT_TABLE_ORDER` (FK-safe), so import trusts that order
 * instead of re-sorting or buffering the file to re-derive it.
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

    for await (const line of readBoundedLines(stream, MAX_NDJSON_LINE_BYTES)) {
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
