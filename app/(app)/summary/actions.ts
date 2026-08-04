"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/src/domain/action-result";
import {
  type BulkServiceItem,
  logServiceEventsBulk,
  type ServiceEventRow,
} from "@/src/domain/service-intervals/events-service";
import { withActionContext } from "@/src/lib/logging/entry-context";

/**
 * Server action for the `/summary` bulk mark-serviced control (R16) — the
 * surface that closes the day-one backlog gap KD6 creates: an owner with
 * many due items can mark a selection of item-and-rule pairs serviced as of
 * one date in a single action, instead of visiting each item.
 *
 * This is a thin wrapper: EVERY authorization, validation, and transaction
 * decision belongs to `logServiceEventsBulk` (`events-service.ts`) — the
 * same domain function the plan requires (R16, KTD3) — never reimplemented,
 * bypassed, or weakened here. `actorId` is always the session-resolved user
 * from `withActionContext`, never client-supplied.
 */
export async function markServicedBulkAction(
  items: BulkServiceItem[],
  servicedOn: string,
  notes?: string,
): Promise<ActionResult<{ events: ServiceEventRow[] }>> {
  return withActionContext("service-bulk-log-events", async (userId) => {
    const events = await logServiceEventsBulk(userId, {
      items,
      servicedOn,
      notes,
    });
    // Revalidate every surface the bulk write can change: the roll-up itself,
    // and the firearm/accessory list markers (R20) for any item that just
    // cleared its only due rule.
    revalidatePath("/summary");
    revalidatePath("/firearms");
    revalidatePath("/accessories");
    return { ok: true, data: { events } };
  });
}
