"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/src/domain/action-result";
import {
  createServiceRuleDefault,
  deleteServiceRuleDefault,
  type ServiceRuleDefaultInput,
  type ServiceRuleDefaultRow,
  type ServiceRuleDefaultUpdateInput,
  type ServiceScope,
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

const VALID_SERVICE_SCOPES = new Set<ServiceScope>(["firearm", "accessory"]);

/**
 * Server-action input arrives as deserialized client JSON with no runtime
 * type guarantee — the `ServiceRuleDefaultInput` type only holds at compile
 * time. A malformed `scope` would otherwise reach `createServiceRuleDefault`
 * and fail at the DB CHECK constraint instead of a clean validation error;
 * `category`/`name` are only checked for their runtime type here (`category`
 * stays free text by design — never validate its VALUE against a fixed list).
 *
 * `input` itself is checked FIRST, before any property read: a malformed
 * payload (`null`, a bare string, a number — anything a client could send in
 * place of a real object) would otherwise throw a raw `TypeError` reading
 * `input.scope` below, escaping this function as an unhandled exception
 * instead of the normal `ValidationError`/`{ ok: false, codes }` path every
 * other malformed submission takes.
 */
function validateServiceRuleDefaultInput(
  input: ServiceRuleDefaultInput,
): string[] {
  if (typeof input !== "object" || input === null) return ["invalidPayload"];

  const codes: string[] = [];
  if (!VALID_SERVICE_SCOPES.has(input.scope)) codes.push("invalidScope");
  if (typeof input.category !== "string") codes.push("invalidCategory");
  if (typeof input.name !== "string") codes.push("invalidRuleName");
  return codes;
}

export async function createServiceRuleDefaultAction(
  input: ServiceRuleDefaultInput,
): Promise<ActionResult<{ default: ServiceRuleDefaultRow }>> {
  const codes = validateServiceRuleDefaultInput(input);
  if (codes.length > 0) return { ok: false, codes };
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
