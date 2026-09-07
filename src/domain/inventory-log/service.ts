import { and, desc, eq, max } from "drizzle-orm";
import {
  authorizeOwnerOnlyUpdate,
  authorizeUpdate,
} from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { resolvePermission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { ammo, inventoryLog } from "@/src/db/schema";
import { ValidationError } from "../errors";
import type { LogParentType } from "./constants";
import { type LogEntryInput, validateLogEntry } from "./validate";

/**
 * Inventory-log service (U3). An append-only audit trail attached to a firearm,
 * magazine, or ammo parent (R4 — no update/delete surface here). Authorization
 * is per-parent-family (KTD2) and dispatched exhaustively (#100 KTD4):
 * firearms and ammo accept an edit grant (`authorizeUpdate`), magazines are
 * owner-only (`authorizeOwnerOnlyUpdate`, mirroring `magazines/service.ts`'s
 * owner-only mutation gate). Reads resolve through `resolvePermission`,
 * throwing `NotFoundError` for an unseen parent so existence is never
 * revealed (R70), mirroring `range-sessions/service.ts`.
 *
 * Ammo entries are reconciliations (#100 KTD3): this is the ONLY insert into
 * `inventory_log`, so the "an ammo entry always corrects the lot" invariant
 * lives inside `createLogEntry` rather than in a separate path that the
 * generic one could bypass.
 */

export type LogEntry = typeof inventoryLog.$inferSelect;

export type LogEntryCreateInput = LogEntryInput;

/** Input to `reconcileAmmo`: the observed count plus the optional entry fields. */
export interface ReconcileAmmoInput {
  countedRounds: number;
  /** Defaults to now; may be back-dated but never in the future (R11). */
  occurredAt?: Date | string;
  notes?: string;
}

async function authorizeLogWrite(
  tx: DbOrTx,
  actorId: string,
  parentType: LogParentType,
  parentId: string,
): Promise<void> {
  switch (parentType) {
    case "firearm":
      await authorizeUpdate(tx, actorId, "firearm", parentId);
      return;
    case "magazine":
      await authorizeOwnerOnlyUpdate(tx, actorId, "magazine", parentId);
      return;
    case "ammo":
      await authorizeUpdate(tx, actorId, "ammo", parentId);
      return;
    default: {
      // Compile error the moment `LogParentType` gains a family this switch
      // does not name — never a silent fall-through to another family's gate.
      const unhandled: never = parentType;
      throw new Error(`unhandled log parent type: ${String(unhandled)}`);
    }
  }
}

/**
 * The ammo half of the reconcile transaction (#100 KTD2/KTD3/KTD5). Locks the
 * lot row so the on-record snapshot and the quantity update cannot interleave
 * with a concurrent edit, reads the lot's latest counted `occurredAt`, and
 * returns the snapshot plus whether this count owns the quantity. The caller
 * inserts the entry, then applies the update when `applies` is true.
 */
async function lockAmmoForReconcile(
  tx: DbOrTx,
  ammoId: string,
  occurredAt: Date,
): Promise<{ recordedRounds: number; applies: boolean }> {
  const [lot] = await tx
    .select({ quantityRounds: ammo.quantityRounds })
    .from(ammo)
    .where(eq(ammo.id, ammoId))
    .for("update");
  if (!lot) throw new NotFoundError();

  const [latest] = await tx
    .select({ last: max(inventoryLog.occurredAt) })
    .from(inventoryLog)
    .where(
      and(
        eq(inventoryLog.parentType, "ammo"),
        eq(inventoryLog.parentId, ammoId),
        eq(inventoryLog.eventType, "inventoried"),
      ),
    );
  // The newest-dated count owns the quantity (KTD5): an entry dated before an
  // existing count is history, not a correction.
  const applies =
    latest?.last === null ||
    latest?.last === undefined ||
    occurredAt.getTime() >= latest.last.getTime();
  return { recordedRounds: lot.quantityRounds, applies };
}

/**
 * Create a log entry. Validated first (before any transaction, R21 parity)
 * so an invalid entry never reaches authorization or the DB. `actorId` is
 * always the acting user (R6) — never a caller-supplied value.
 *
 * For an `ammo` parent the same transaction snapshots the lot's quantity into
 * `recordedRounds` and, when this is the newest-dated count, sets the lot's
 * quantity to `countedRounds` (R5). Neither half lands without the other.
 */
export async function createLogEntry(
  actorId: string,
  input: LogEntryCreateInput,
): Promise<LogEntry> {
  const codes = validateLogEntry(input);
  if (codes.length > 0) throw new ValidationError(codes);
  // The validator admitted the family, so the narrowing is safe here.
  const parentType = input.parentType as LogParentType;
  const occurredAt = new Date(input.occurredAt);

  return db.transaction(async (tx) => {
    await authorizeLogWrite(tx, actorId, parentType, input.parentId);

    const reconcile =
      parentType === "ammo"
        ? await lockAmmoForReconcile(tx, input.parentId, occurredAt)
        : null;

    const [row] = await tx
      .insert(inventoryLog)
      .values({
        parentType,
        parentId: input.parentId,
        eventType: input.eventType,
        actorId,
        occurredAt,
        notes: input.notes ?? "",
        countedRounds: reconcile ? (input.countedRounds ?? null) : null,
        recordedRounds: reconcile ? reconcile.recordedRounds : null,
      })
      .returning();

    if (reconcile?.applies && input.countedRounds !== undefined) {
      await tx
        .update(ammo)
        .set({ quantityRounds: input.countedRounds, updatedAt: new Date() })
        .where(eq(ammo.id, input.parentId));
    }
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
 * regular logging rules. On an ammo lot this fails validation
 * (`countedRoundsRequired`): a count without a number is not a reconciliation.
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

/**
 * Reconcile an ammo lot against a physical count (#100, R5). A named wrapper
 * over `createLogEntry`, like `markInventoried`, so the reconcile invariant
 * has exactly one implementation.
 */
export async function reconcileAmmo(
  actorId: string,
  ammoId: string,
  input: ReconcileAmmoInput,
): Promise<LogEntry> {
  return createLogEntry(actorId, {
    parentType: "ammo",
    parentId: ammoId,
    eventType: "inventoried",
    occurredAt: input.occurredAt ?? new Date(),
    notes: input.notes,
    countedRounds: input.countedRounds,
  });
}
