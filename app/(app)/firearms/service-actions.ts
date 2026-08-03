"use server";

import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/src/auth/errors";
import type { ActionResult } from "@/src/domain/action-result";
import {
  logServiceEvent,
  type ServiceEventInput,
  type ServiceEventRow,
} from "@/src/domain/service-intervals/events-service";
import {
  createItemRule,
  deleteItemRule,
  type ItemRuleInput,
  listItemRules,
  type ServiceParentType,
  type ServiceRuleRow,
  updateItemRule,
} from "@/src/domain/service-intervals/rules-service";
import { withActionContext } from "@/src/lib/logging/entry-context";

/**
 * Server actions for the item-detail service panel (U8) — log-service and
 * the five rule actions (override, reset-to-inherited, suppress, restore,
 * add-item-only). Shared by both families: `service-rules-panel.tsx` is the
 * one panel component for firearms and accessories alike, and it imports
 * this single module regardless of which detail view mounts it (mirroring
 * `mounted-accessories.tsx` already living in `firearms/` and being
 * referenced from the accessories side) — `accessories/actions.ts` gains no
 * parallel copy of these, since every domain call here is already generic
 * over `ServiceParentType` and a second wrapper module would just be
 * duplication with nothing accessory-specific to add (KISS/DRY).
 *
 * Every write here delegates authorization entirely to `rules-service.ts` /
 * `events-service.ts` (KTD3) — this file never re-implements a permission
 * check. The rule actions are keyed by rule NAME from the client's point of
 * view (the resolved-rule shape `getItemDueState` already returns has no
 * item-rule row id for an "inherited" rule, since none exists yet) — each
 * action here resolves the name to an existing item-rule row, if one
 * exists, immediately before the authorized write.
 */

function revalidateItemPath(
  parentType: ServiceParentType,
  parentId: string,
): void {
  revalidatePath(
    parentType === "firearm"
      ? `/firearms/${parentId}`
      : `/accessories/${parentId}`,
  );
}

async function findItemRuleByName(
  userId: string,
  parentType: ServiceParentType,
  parentId: string,
  name: string,
): Promise<ServiceRuleRow | null> {
  const rows = await listItemRules(userId, parentType, parentId);
  return rows.find((row) => row.name === name) ?? null;
}

export async function logServiceEventAction(
  parentType: ServiceParentType,
  parentId: string,
  input: ServiceEventInput,
): Promise<ActionResult<{ event: ServiceEventRow }>> {
  return withActionContext("service-log-event", async (userId) => {
    const event = await logServiceEvent(userId, parentType, parentId, input);
    revalidateItemPath(parentType, parentId);
    return { ok: true, data: { event } };
  });
}

export interface RuleThresholdInput {
  name: string;
  intervalDays: number | null;
  intervalSessions: number | null;
  intervalRounds: number | null;
}

/**
 * The "Override" action: create-or-update this item's thresholds for
 * `input.name`. Creates a new item-rule row when the item has no entry for
 * that name yet (an "inherited" rule becoming "overridden"); updates the
 * existing row otherwise (adjusting an already-overridden rule).
 */
export async function overrideServiceRuleAction(
  parentType: ServiceParentType,
  parentId: string,
  input: RuleThresholdInput,
): Promise<ActionResult<{ rule: ServiceRuleRow }>> {
  return withActionContext("service-override-rule", async (userId) => {
    const existing = await findItemRuleByName(
      userId,
      parentType,
      parentId,
      input.name,
    );
    const payload: ItemRuleInput = { ...input, suppressed: false };
    const rule = existing
      ? await updateItemRule(userId, parentType, parentId, existing.id, payload)
      : await createItemRule(userId, parentType, parentId, payload);
    revalidateItemPath(parentType, parentId);
    return { ok: true, data: { rule } };
  });
}

/** The "Add item-only rule" action: a new rule with no matching default. */
export async function addItemOnlyRuleAction(
  parentType: ServiceParentType,
  parentId: string,
  input: RuleThresholdInput,
): Promise<ActionResult<{ rule: ServiceRuleRow }>> {
  return withActionContext("service-add-item-only-rule", async (userId) => {
    const rule = await createItemRule(userId, parentType, parentId, {
      ...input,
      suppressed: false,
    });
    revalidateItemPath(parentType, parentId);
    return { ok: true, data: { rule } };
  });
}

/** The "Reset to inherited" action: delete this item's override for `ruleName`. */
export async function resetServiceRuleAction(
  parentType: ServiceParentType,
  parentId: string,
  ruleName: string,
): Promise<ActionResult> {
  return withActionContext("service-reset-rule", async (userId) => {
    const existing = await findItemRuleByName(
      userId,
      parentType,
      parentId,
      ruleName,
    );
    if (!existing) throw new NotFoundError();
    await deleteItemRule(userId, parentType, parentId, existing.id);
    revalidateItemPath(parentType, parentId);
    return { ok: true };
  });
}

/**
 * The "Suppress" action: hide `ruleName` from this item's active rule set
 * without deleting an existing override's row identity — updates it in
 * place (nulling its thresholds, KTD6) when one exists, else creates a new
 * suppressed row.
 */
export async function suppressServiceRuleAction(
  parentType: ServiceParentType,
  parentId: string,
  ruleName: string,
): Promise<ActionResult> {
  return withActionContext("service-suppress-rule", async (userId) => {
    const existing = await findItemRuleByName(
      userId,
      parentType,
      parentId,
      ruleName,
    );
    if (existing) {
      await updateItemRule(userId, parentType, parentId, existing.id, {
        name: ruleName,
        suppressed: true,
      });
    } else {
      await createItemRule(userId, parentType, parentId, {
        name: ruleName,
        suppressed: true,
      });
    }
    revalidateItemPath(parentType, parentId);
    return { ok: true };
  });
}

/** The "Restore" action: un-suppress `ruleName` (KTD6 — deleting the row is the restoration). */
export async function restoreServiceRuleAction(
  parentType: ServiceParentType,
  parentId: string,
  ruleName: string,
): Promise<ActionResult> {
  return withActionContext("service-restore-rule", async (userId) => {
    const existing = await findItemRuleByName(
      userId,
      parentType,
      parentId,
      ruleName,
    );
    if (!existing) throw new NotFoundError();
    await deleteItemRule(userId, parentType, parentId, existing.id);
    revalidateItemPath(parentType, parentId);
    return { ok: true };
  });
}
