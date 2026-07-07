"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/auth/session";
import { namesByIds } from "@/src/auth/users";
import type { ParentType } from "@/src/auth/visibility";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import {
  createLogEntry,
  type LogEntry,
  type LogEntryCreateInput,
  listLogForParent,
  markInventoried,
} from "@/src/domain/inventory-log/service";

/** A log entry with its actor's display name attached for the UI (R9). */
export interface LogEntryWithActor extends LogEntry {
  actorName: string;
}

/**
 * Display label when `actorId` is `null` — the authoring account was later
 * deleted (`actor_id` FK is `ON DELETE SET NULL`, see `inventory-schema.ts`);
 * the entry itself is preserved, only attribution degrades.
 */
const UNKNOWN_ACTOR_LABEL = "Unknown";

/** Mutations resolve the session themselves (R66) before touching the domain. */
async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthenticated");
  return user.id;
}

/** Shared across the firearm and magazine detail views (one action, one authorization path). */
export async function logEventAction(
  input: LogEntryCreateInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await createLogEntry(userId, input);
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function markInventoriedAction(
  parentType: ParentType,
  parentId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const created = await markInventoried(userId, parentType, parentId);
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Read-only history load for the on-demand log panel (no revalidate).
 * Attaches each entry's actor display name (R9 — "actor" should identify who,
 * not a raw id). Resolves to `name` rather than `email`: the log is readable
 * by view-grantees too (AE3/R8), a broader audience than the owner-only
 * sharing UI that resolves `email` (`grants/actions.ts`), so a raw email
 * address is not surfaced to viewers who may not otherwise have it. Falls
 * back to the raw `actorId` if the account can't be resolved.
 */
export async function listLogAction(
  parentType: ParentType,
  parentId: string,
): Promise<ActionResult<{ entries: LogEntryWithActor[] }>> {
  try {
    const userId = await requireUserId();
    const entries = await listLogForParent(userId, parentType, parentId);
    const actorIds = entries
      .map((e) => e.actorId)
      .filter((id): id is string => id !== null);
    const nameById = await namesByIds([...new Set(actorIds)]);
    return {
      ok: true,
      data: {
        entries: entries.map((e) => ({
          ...e,
          actorName:
            e.actorId === null
              ? UNKNOWN_ACTOR_LABEL
              : (nameById.get(e.actorId) ?? e.actorId),
        })),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}
