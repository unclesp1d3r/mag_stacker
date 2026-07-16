"use server";

import { revalidatePath } from "next/cache";
import {
  createGrant,
  type GrantPermission,
  listGrantsForItem,
  revokeGrant,
} from "@/src/auth/grants";
import { listShareableUsers, type ShareableUser } from "@/src/auth/users";
import { type ParentType, resolvePermission } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import type { ActionResult } from "@/src/domain/action-result";
import { withActionContext } from "@/src/lib/logging/entry-context";

export interface ShareGrant {
  granteeId: string;
  granteeEmail: string;
  permission: GrantPermission;
  allowCreateOnBehalf: boolean;
}

export interface ShareState {
  candidates: ShareableUser[];
  grants: ShareGrant[];
}

/** Load the candidates + active grants for an owned item. Owner-only. */
export async function loadShareState(
  parentType: ParentType,
  parentId: string,
): Promise<ActionResult<ShareState>> {
  return withActionContext("grants", async (userId) => {
    if (
      (await resolvePermission(db, userId, parentType, parentId)) !== "owner"
    ) {
      return { ok: false, error: "Only the owner can manage sharing." };
    }
    const [candidates, grants] = await Promise.all([
      listShareableUsers(userId),
      listGrantsForItem(db, userId, parentType, parentId),
    ]);
    const emailById = new Map(candidates.map((c) => [c.id, c.email]));
    return {
      ok: true,
      data: {
        candidates,
        grants: grants.map((g) => ({
          granteeId: g.granteeId,
          granteeEmail: emailById.get(g.granteeId) ?? g.granteeId,
          permission: g.permission,
          allowCreateOnBehalf: g.allowCreateOnBehalf,
        })),
      },
    };
  });
}

export async function shareItemAction(
  parentType: ParentType,
  parentId: string,
  granteeId: string,
  permission: GrantPermission,
  allowCreateOnBehalf: boolean,
): Promise<ActionResult> {
  return withActionContext("grants", async (userId) => {
    await createGrant(db, {
      actorId: userId,
      granteeId,
      parentType,
      parentId,
      permission,
      allowCreateOnBehalf,
    });
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    revalidatePath("/ammo");
    return { ok: true };
  });
}

export async function revokeGrantAction(
  parentType: ParentType,
  parentId: string,
  granteeId: string,
): Promise<ActionResult> {
  return withActionContext("grants", async (userId) => {
    await revokeGrant(db, { actorId: userId, granteeId, parentType, parentId });
    revalidatePath("/firearms");
    revalidatePath("/magazines");
    revalidatePath("/ammo");
    return { ok: true };
  });
}
