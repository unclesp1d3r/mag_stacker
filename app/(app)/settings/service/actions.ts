"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/src/domain/action-result";
import {
  createServiceRuleDefault,
  deleteServiceRuleDefault,
  type ServiceRuleDefaultInput,
  type ServiceRuleDefaultRow,
  type ServiceRuleDefaultUpdateInput,
  updateServiceRuleDefault,
} from "@/src/domain/service-intervals/rules-service";
import { withActionContext } from "@/src/lib/logging/entry-context";

/**
 * Server actions for the service-defaults settings surface (U7). Every
 * default write here is owner-only by construction — `createServiceRuleDefault`
 * / `updateServiceRuleDefault` / `deleteServiceRuleDefault` (`rules-service.ts`,
 * U3) key every read and write on the resolved actor id, never a client-
 * supplied owner (KTD3). `withActionContext` resolves that actor from the
 * session and rejects an unauthenticated caller before any of them run.
 */

function revalidateServiceDefaultsPath(): void {
  revalidatePath("/settings/service");
}

export async function createServiceRuleDefaultAction(
  input: ServiceRuleDefaultInput,
): Promise<ActionResult<{ default: ServiceRuleDefaultRow }>> {
  return withActionContext("settings-service-defaults", async (userId) => {
    const created = await createServiceRuleDefault(userId, input);
    revalidateServiceDefaultsPath();
    return { ok: true, data: { default: created } };
  });
}

export async function updateServiceRuleDefaultAction(
  id: string,
  input: ServiceRuleDefaultUpdateInput,
): Promise<ActionResult<{ default: ServiceRuleDefaultRow }>> {
  return withActionContext("settings-service-defaults", async (userId) => {
    const updated = await updateServiceRuleDefault(userId, id, input);
    revalidateServiceDefaultsPath();
    return { ok: true, data: { default: updated } };
  });
}

export async function deleteServiceRuleDefaultAction(
  id: string,
): Promise<ActionResult> {
  return withActionContext("settings-service-defaults", async (userId) => {
    await deleteServiceRuleDefault(userId, id);
    revalidateServiceDefaultsPath();
    return { ok: true };
  });
}
