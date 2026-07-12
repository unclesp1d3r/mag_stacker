/**
 * Operator-event logging (plan Unit U6, R15, KTD6).
 *
 * Records every admin-run backup export/restore attempt to the
 * `operator_audit` table (U3's schema — `src/db/operator-audit-schema.ts`):
 * actor, action, outcome, and timestamp (defaulted by the column). Both
 * routes (`app/api/admin/backup/export/route.ts`,
 * `app/api/admin/backup/restore/route.ts`) call this for success AND failure
 * outcomes, so a force-replace restore — the most destructive action in the
 * app — always leaves a trail of who ran it and how it went (R15).
 */

import { type DbOrTx, db as defaultDb } from "@/src/db/client";
import { operatorAudit } from "@/src/db/operator-audit-schema";

/** Matches the `operator_audit_action_valid` CHECK constraint. */
export type OperatorAction = "export" | "restore";

export interface RecordOperatorEventInput {
  /**
   * The acting user's identity. This repo's audit table deliberately carries
   * no FK to `user` (the row must outlive the account that produced it), so
   * callers pass the admin's email — a value that still identifies them after
   * account deletion, mirroring `operator-audit-schema.ts`'s doc comment.
   */
  readonly actor: string;
  readonly action: OperatorAction;
  /**
   * Free-text outcome description — e.g. `"success"`, a `RestoreOutcome`
   * `kind` (`"ok"`, `"refused_not_empty"`, ...), or `"failure: <message>"`.
   * Kept as free text rather than a second CHECK-constrained enum: the set of
   * things that can go wrong (crypto errors, DB errors, bad requests) is
   * open-ended, and the audit trail's job is to record what happened, not to
   * validate it.
   */
  readonly outcome: string;
  /** DI seam for tests — defaults to the shared singleton (`src/db/client.ts`). */
  readonly db?: DbOrTx;
}

/** Appends one row to `operator_audit`. Callers decide how to handle a write
 * failure (e.g. swallow it so a real export/restore result isn't masked by a
 * logging failure) — this function itself does not swallow errors. */
export async function recordOperatorEvent(
  input: RecordOperatorEventInput,
): Promise<void> {
  const db = input.db ?? defaultDb;
  await db.insert(operatorAudit).values({
    actor: input.actor,
    action: input.action,
    outcome: input.outcome,
  });
}
