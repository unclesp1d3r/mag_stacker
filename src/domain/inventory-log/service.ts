import { and, desc, eq } from "drizzle-orm";
import {
  authorizeOwnerOnlyUpdate,
  authorizeUpdate,
} from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { resolvePermission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { inventoryLog } from "@/src/db/schema";
import { ValidationError } from "../errors";
import { type LogEntryInput, validateLogEntry } from "./validate";

/**
 * Inventory-log service (U3). An append-only audit trail attached to a firearm
 * or magazine parent (R4 — no update/delete surface here). Authorization is
 * per-parent-family (KTD2): firearms accept an edit grant (`authorizeUpdate`),
 * magazines are owner-only (`authorizeOwnerOnlyUpdate`, mirroring
 * `magazines/service.ts`'s owner-only mutation gate). Reads resolve through
 * `resolvePermission`, throwing `NotFoundError` for an unseen parent so
 * existence is never revealed (R70), mirroring `range-sessions/service.ts`.
 */

export type LogEntry = typeof inventoryLog.$inferSelect;

export type LogEntryCreateInput = LogEntryInput;

async function authorizeLogWrite(
  tx: DbOrTx,
  actorId: string,
  input: LogEntryInput,
): Promise<void> {
  if (input.parentType === "firearm") {
    await authorizeUpdate(tx, actorId, "firearm", input.parentId);
  } else {
    await authorizeOwnerOnlyUpdate(tx, actorId, "magazine", input.parentId);
  }
}

/**
 * Create a log entry. Validated first (before any transaction, R21 parity)
 * so an invalid entry never reaches authorization or the DB. `actorId` is
 * always the acting user (R6) — never a caller-supplied value.
 */
export async function createLogEntry(
  actorId: string,
  input: LogEntryCreateInput,
): Promise<LogEntry> {
  const codes = validateLogEntry(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    await authorizeLogWrite(tx, actorId, input);
    const [row] = await tx
      .insert(inventoryLog)
      .values({
        parentType: input.parentType,
        parentId: input.parentId,
        eventType: input.eventType,
        actorId,
        occurredAt: new Date(input.occurredAt),
        notes: input.notes ?? "",
      })
      .returning();
    return row;
  });
}

/**
 * A parent's log entries, newest first. Not-found when the parent is outside
 * the requester's visible set (existence is never revealed, R70).
 */
export async function listLogForParent(
  actorId: string,
  parentType: LogEntryInput["parentType"],
  parentId: string,
): Promise<LogEntry[]> {
  const perm = await resolvePermission(db, actorId, parentType, parentId);
  if (perm === null) throw new NotFoundError();
  return db
    .select()
    .from(inventoryLog)
    .where(
      and(
        eq(inventoryLog.parentType, parentType),
        eq(inventoryLog.parentId, parentId),
      ),
    )
    .orderBy(desc(inventoryLog.occurredAt), desc(inventoryLog.createdAt));
}

/**
 * Record an "inventoried" check-in for a parent (R10). A thin wrapper over
 * `createLogEntry` — it reuses the same validate + per-parent-authorize path
 * rather than writing a separate insert, so it can never drift from the
 * regular logging rules.
 */
export async function markInventoried(
  actorId: string,
  parentType: LogEntryInput["parentType"],
  parentId: string,
): Promise<LogEntry> {
  return createLogEntry(actorId, {
    parentType,
    parentId,
    eventType: "inventoried",
    occurredAt: new Date(),
  });
}
