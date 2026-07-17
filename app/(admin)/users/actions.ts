"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { getCurrentUser } from "@/src/auth/session";
import { assertWritesAllowed } from "@/src/backup/maintenance";
import { db } from "@/src/db/client";
import { childLogger } from "@/src/lib/logging";
import { withAdminActionContext } from "@/src/lib/logging/entry-context";

const log = childLogger("users");

/**
 * Operator account-management actions (U13, R7). Each re-resolves the session
 * and requires the admin role before calling the Better Auth admin API (which
 * also enforces admin via the passed session headers — defense in depth).
 */

async function requireAdmin(): Promise<void> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    throw new Error("Forbidden");
  }
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createAccountAction(
  formData: FormData,
): Promise<ActionResult> {
  return withAdminActionContext("users", async () => {
    await requireAdmin();
    const email = String(formData.get("email") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim() || email;
    const password = String(formData.get("password") ?? "");
    if (!email || password.length < 8) {
      return {
        ok: false,
        error: "Email is required and password must be at least 8 characters.",
      };
    }
    try {
      await assertWritesAllowed(db);
      await auth.api.createUser({
        body: { email, password, name, role: "user" },
        headers: await headers(),
      });
      revalidatePath("/users");
      return { ok: true };
    } catch (error) {
      // These admin actions use a bespoke ActionResult and do not funnel
      // through toActionError, so log the failure explicitly — otherwise a
      // failed account create leaves no server-side trail (the correlation id
      // + actor are already seeded by withAdminActionContext).
      log.error({ err: error }, "createAccount failed");
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not create account.",
      };
    }
  });
}

export async function setAccountDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<ActionResult> {
  return withAdminActionContext("users", async () => {
    await requireAdmin();
    try {
      await assertWritesAllowed(db);
      const h = await headers();
      if (disabled) {
        await auth.api.banUser({ body: { userId }, headers: h });
      } else {
        await auth.api.unbanUser({ body: { userId }, headers: h });
      }
      revalidatePath("/users");
      return { ok: true };
    } catch (error) {
      log.error({ err: error, userId, disabled }, "setAccountDisabled failed");
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not update account.",
      };
    }
  });
}
