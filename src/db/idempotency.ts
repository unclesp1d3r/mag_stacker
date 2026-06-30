import { and, eq, lt } from "drizzle-orm";
import { db, type Transaction } from "./client";
import { idempotency } from "./schema";

/**
 * Idempotent action runner (U12, R69/KTD-9).
 *
 * Dedup is an ATOMIC insert-conflict against the `(user_id, idempotency_key)`
 * unique table — not check-then-insert (which would race two concurrent
 * submissions into 2N records). The action runs inside the same transaction as
 * the claim, so a create + its dedup row commit together. A replay within the
 * window returns the originally stored result; an expired key is reclaimed as a
 * fresh action.
 *
 * Concurrency: two submissions with the same key serialize on the unique index —
 * the second INSERT blocks until the first transaction commits, then sees the
 * live row and returns the stored result. Exactly one action ever runs.
 *
 * The stored result is JSON (jsonb); on replay it is the JSON snapshot of the
 * original result (Dates become ISO strings), which is what a Server Action
 * would serialize to the client anyway.
 */
export const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export async function withIdempotency<T>(
  userId: string,
  key: string,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_WINDOW_MS);

    // Claim the key: insert, or reclaim ONLY if the existing row has expired.
    // A live (unexpired) conflict leaves `claimed` empty → it is a replay.
    const claimed = await tx
      .insert(idempotency)
      .values({ userId, idempotencyKey: key, expiresAt, result: null })
      .onConflictDoUpdate({
        target: [idempotency.userId, idempotency.idempotencyKey],
        set: { expiresAt, result: null },
        setWhere: lt(idempotency.expiresAt, now),
      })
      .returning({ userId: idempotency.userId });

    if (claimed.length > 0) {
      const result = await action(tx);
      await tx
        .update(idempotency)
        .set({ result: result as unknown })
        .where(
          and(
            eq(idempotency.userId, userId),
            eq(idempotency.idempotencyKey, key),
          ),
        );
      return result;
    }

    // Replay: a live row already owns this key — return its stored result.
    const [existing] = await tx
      .select({ result: idempotency.result })
      .from(idempotency)
      .where(
        and(
          eq(idempotency.userId, userId),
          eq(idempotency.idempotencyKey, key),
        ),
      )
      .limit(1);
    return existing?.result as T;
  });
}

/** Remove expired idempotency rows (periodic sweep; also pruned opportunistically). */
export async function pruneExpiredIdempotencyKeys(): Promise<void> {
  await db.delete(idempotency).where(lt(idempotency.expiresAt, new Date()));
}
