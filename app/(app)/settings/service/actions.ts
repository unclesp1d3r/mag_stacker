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
 * type guarantee — the `ServiceRuleDefaultInput` / `...UpdateInput` types
 * only hold at compile time. A malformed payload (`null`, a bare string, a
 * number — anything a client could send in place of a real object) would
 * otherwise throw a raw `TypeError` reading a property off it, escaping the
 * action as an unhandled exception instead of the normal
 * `ValidationError`/`{ ok: false, codes }` path every other malformed
 * submission takes. `isPlainObjectPayload` is the shared first check every
 * object-shaped action input runs through before any property read.
 */
function isPlainObjectPayload(
  input: unknown,
): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

/**
 * Full-shape guard for create: a malformed `scope` would otherwise reach
 * `createServiceRuleDefault` and fail at the DB CHECK constraint instead of a
 * clean validation error; `category`/`name` are only checked for their
 * runtime type here (`category` stays free text by design — never validate
 * its VALUE against a fixed list).
 */
function validateServiceRuleDefaultInput(
  input: ServiceRuleDefaultInput,
): string[] {
  if (!isPlainObjectPayload(input)) return ["invalidPayload"];

  const codes: string[] = [];
  if (!VALID_SERVICE_SCOPES.has(input.scope as ServiceScope))
    codes.push("invalidScope");
  if (typeof input.category !== "string") codes.push("invalidCategory");
  if (typeof input.name !== "string") codes.push("invalidRuleName");
  return codes;
}

/**
 * Update carries no `scope`/`category` (`ServiceRuleDefaultUpdateInput` omits
 * them — it targets an existing row by id) so only the object check and
 * `name`'s runtime type apply; `updateServiceRuleDefault` calls
 * `input.name.trim()`, which would otherwise throw the same raw `TypeError`
 * create's guard exists to prevent.
 */
function validateServiceRuleDefaultUpdateInput(
  input: ServiceRuleDefaultUpdateInput,
): string[] {
  if (!isPlainObjectPayload(input)) return ["invalidPayload"];
  if (typeof input.name !== "string") return ["invalidRuleName"];
  return [];
}

/**
 * Delete's payload IS the id (no wrapping object) — it has no fields to
 * validate beyond its own type, so it gets its own minimal check rather than
 * being forced through the object-shaped validators above.
 */
function validateServiceRuleDefaultId(id: string): string[] {
  return typeof id === "string" ? [] : ["invalidPayload"];
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
  const codes = validateServiceRuleDefaultUpdateInput(input);
  if (codes.length > 0) return { ok: false, codes };
  return withActionContext("settings-service-defaults", async (userId) => {
    const updated = await updateServiceRuleDefault(userId, id, input);
    revalidateServiceDefaultsPath();
    return { ok: true, data: { default: updated } };
  });
}

export async function deleteServiceRuleDefaultAction(
  id: string,
): Promise<ActionResult> {
  const codes = validateServiceRuleDefaultId(id);
  if (codes.length > 0) return { ok: false, codes };
  return withActionContext("settings-service-defaults", async (userId) => {
    await deleteServiceRuleDefault(userId, id);
    revalidateServiceDefaultsPath();
    return { ok: true };
  });
}
