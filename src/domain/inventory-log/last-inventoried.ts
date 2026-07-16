import { and, eq, inArray, max } from "drizzle-orm";
import type { ParentType } from "@/src/auth/visibility";
import type { DbOrTx } from "@/src/db/client";
import { inventoryLog } from "@/src/db/inventory-schema";

/**
 * Batched last-inventoried lookup (U1, #70). One grouped `max(occurred_at)`
 * query over `inventoried` inventory-log entries for many parents at once —
 * no per-row query (mirrors the Map-returning shape of
 * `loadCompatibilityBatch` in `src/domain/magazines/compatibility.ts`).
 *
 * TRUSTS its `parentIds` input and performs no visibility check — callers
 * must pass only ids already scoped to what the requester may see.
 *
 * A parent with no `inventoried` entry is absent from the returned map (the
 * "never inventoried" state); callers should treat a missing key that way
 * rather than defaulting to some other date.
 */
export async function loadLastInventoriedBatch(
  db: DbOrTx,
  parentType: ParentType,
  parentIds: string[],
): Promise<Map<string, Date>> {
  const byParent = new Map<string, Date>();
  if (parentIds.length === 0) return byParent;

  const rows = await db
    .select({
      parentId: inventoryLog.parentId,
      last: max(inventoryLog.occurredAt),
    })
    .from(inventoryLog)
    .where(
      and(
        eq(inventoryLog.parentType, parentType),
        eq(inventoryLog.eventType, "inventoried"),
        inArray(inventoryLog.parentId, parentIds),
      ),
    )
    .groupBy(inventoryLog.parentId);

  for (const row of rows) {
    if (row.last === null) continue; // defensive; groupBy never yields this
    byParent.set(row.parentId, row.last);
  }
  return byParent;
}
