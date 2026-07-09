import { asc, eq, inArray } from "drizzle-orm";
import {
  authorizeMount,
  listVisibleAccessoryIds,
  resolveAccessoryPermission,
} from "@/src/auth/accessory-visibility";
import { authorizeUpdate, resolveCreateOwner } from "@/src/auth/authorize";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import type { Permission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { accessory, firearm } from "@/src/db/schema";
import { ValidationError } from "../errors";
import { type AccessoryFields, validateAccessory } from "./validate";

/**
 * Accessory service (U4). Visibility-scoped CRUD plus mount/reassign/unmount,
 * mirroring `src/domain/ammo/service.ts`'s shape. Accessories are NOT a grant
 * `ParentType` (see `src/auth/accessory-visibility.ts`) — a mounted
 * accessory's permission inherits from its firearm, so this file routes
 * every read/write through `resolveAccessoryPermission`/`authorizeMount`
 * instead of the shared `authorize.ts` gates, and deletes are bespoke (no
 * `authorizeAndDeleteParent`, since accessories aren't a `ParentType`).
 * Validation runs before any write (R8); raw values are persisted (R18)
 * except where noted.
 */

export type Accessory = typeof accessory.$inferSelect;

export interface AccessoryInput extends AccessoryFields {
  /** Optional brand/model/serial/notes; empty-not-null when omitted (R18). */
  brand?: string;
  model?: string;
  serialNumber?: string;
  notes?: string;
}

export interface AccessoryCreateInput extends AccessoryInput {
  /** Create-on-behalf target owner; defaults to the acting user (KTD-5). */
  ownerId?: string;
  /** Mount target on create, or unmounted when omitted/null. */
  firearmId?: string | null;
}

/** Mount is a separate op (`mountAccessory`), not part of a plain update. */
export type AccessoryUpdateInput = Omit<
  AccessoryCreateInput,
  "ownerId" | "firearmId"
>;

/**
 * `installedDate` records when the CURRENT mount began (R6), so it can never
 * be set on an unmounted accessory — `mountedFirearmId` is the resolved mount
 * target for this write (the create-time `firearmId`, or the row's persisted
 * `currentFirearmId` on a plain update, which `updateAccessory` never
 * changes). When there is no mount, the date is forced to null regardless of
 * what the caller supplied, backstopped by the `accessory_installed_date_
 * requires_mount` CHECK.
 */
function persistableFields(
  input: AccessoryInput,
  mountedFirearmId: string | null,
) {
  return {
    // Raw values persisted verbatim (R18/R19); optional text is empty-not-null.
    // `category` is trimmed so the list view's exact-match category grouping
    // can't be split by incidental leading/trailing whitespace.
    category: input.category.trim(),
    brand: input.brand ?? "",
    model: input.model ?? "",
    serialNumber: input.serialNumber ?? "",
    installedDate: mountedFirearmId ? (input.installedDate ?? null) : null,
    costCents: input.costCents ?? null,
    notes: input.notes ?? "",
    isNfa: input.isNfa ?? false,
  };
}

/**
 * Verify a create-time mount is allowed: the actor must be able to edit the
 * target firearm, and that firearm must be owned by the same user as the
 * new accessory (mirrors `authorizeMount`'s cross-tenant guard) — the
 * accessory doesn't exist yet, so `authorizeMount` itself can't be called.
 */
async function authorizeCreateMount(
  tx: DbOrTx,
  actorId: string,
  ownerId: string,
  firearmId: string,
): Promise<void> {
  await authorizeUpdate(tx, actorId, "firearm", firearmId);

  const rows = await tx
    .select({ ownerId: firearm.ownerId })
    .from(firearm)
    .where(eq(firearm.id, firearmId))
    .limit(1);
  if (rows.length === 0) throw new NotFoundError();
  if (rows[0].ownerId !== ownerId) {
    throw new NotAuthorizedError(
      "an accessory may only be mounted on a firearm owned by its owner",
    );
  }
}

/**
 * Require owner/edit on an accessory (edit only ever arises via a mounted
 * accessory's firearm inheritance). A view-grantee is visible-but-forbidden
 * (R70-style); an item outside the visible set is not-found.
 */
async function requireEditPermission(
  tx: DbOrTx,
  actorId: string,
  id: string,
): Promise<Permission> {
  const permission = await resolveAccessoryPermission(tx, actorId, id);
  if (permission === "owner" || permission === "edit") return permission;
  if (permission === "view") {
    throw new NotAuthorizedError(
      "read-only access; cannot modify this accessory",
    );
  }
  throw new NotFoundError();
}

export async function createAccessory(
  actorId: string,
  input: AccessoryCreateInput,
): Promise<Accessory> {
  const codes = validateAccessory(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    const ownerId = await resolveCreateOwner(tx, actorId, input.ownerId);

    // Normalize the mount target once so the authorization guard and the
    // persisted value can never disagree: an empty-string `firearmId` is
    // treated as unmounted everywhere, never persisted into the uuid FK.
    const mountedFirearmId = input.firearmId || null;
    if (mountedFirearmId) {
      await authorizeCreateMount(tx, actorId, ownerId, mountedFirearmId);
    }

    const [row] = await tx
      .insert(accessory)
      .values({
        ownerId,
        currentFirearmId: mountedFirearmId,
        ...persistableFields(input, mountedFirearmId),
      })
      .returning();
    return row;
  });
}

export async function updateAccessory(
  actorId: string,
  id: string,
  input: AccessoryUpdateInput,
): Promise<Accessory> {
  const codes = validateAccessory(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    await requireEditPermission(tx, actorId, id);
    // A plain update never changes the mount (mount is a separate op via
    // `mountAccessory`) — load the CURRENT `currentFirearmId` so
    // `persistableFields` can force `installedDate` to null when the
    // accessory is unmounted (R6); an unmounted accessory can never acquire
    // an installed date through this path.
    const [existing] = await tx
      .select({ currentFirearmId: accessory.currentFirearmId })
      .from(accessory)
      .where(eq(accessory.id, id))
      .limit(1);
    if (!existing) throw new NotFoundError();
    const [row] = await tx
      .update(accessory)
      .set({
        ...persistableFields(input, existing.currentFirearmId),
        updatedAt: new Date(),
      })
      .where(eq(accessory.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

/**
 * Mount, reassign, or unmount an accessory (`firearmId === null` unmounts).
 * Reassigning to a firearm resets `installedDate` to today (R6) — the new
 * mount is the meaningful "installed" event, so the old date no longer
 * applies. Unmounting clears `installedDate` to null.
 */
export async function mountAccessory(
  actorId: string,
  id: string,
  firearmId: string | null,
): Promise<Accessory> {
  return db.transaction(async (tx) => {
    await authorizeMount(tx, actorId, id, firearmId);
    const [row] = await tx
      .update(accessory)
      .set({
        currentFirearmId: firearmId,
        installedDate: firearmId ? new Date().toISOString().slice(0, 10) : null,
        updatedAt: new Date(),
      })
      .where(eq(accessory.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

/** Get a single accessory, or not-found if it is outside the requester's visible set. */
export async function getAccessory(
  actorId: string,
  id: string,
): Promise<{ accessory: Accessory; permission: Permission }> {
  const permission = await resolveAccessoryPermission(db, actorId, id);
  if (permission === null) throw new NotFoundError();
  const [row] = await db
    .select()
    .from(accessory)
    .where(eq(accessory.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  // Return the viewer's permission alongside the row so the caller doesn't
  // re-resolve it (one query, and no read-vs-permission race between two calls).
  return { accessory: row, permission };
}

/**
 * Owned + mounted-on-visible-firearm accessories ordered by category, then
 * brand (ascending); always an array (R68-style).
 */
export async function listAccessories(actorId: string): Promise<Accessory[]> {
  const visible = await listVisibleAccessoryIds(db, actorId);
  if (visible.size === 0) return [];
  return db
    .select()
    .from(accessory)
    .where(inArray(accessory.id, [...visible]))
    .orderBy(asc(accessory.category), asc(accessory.brand));
}

/**
 * Accessories currently mounted on `firearmId` (U6). Per KTD1, every viewer
 * who can see the firearm sees all of its mounted accessories — the caller
 * (the firearm detail page) has already resolved firearm visibility via
 * `getFirearm`, so this filters directly by `currentFirearmId` rather than
 * re-deriving per-accessory permission. `actorId` is accepted for signature
 * parity with the other service reads (and is available to a future caller
 * that hasn't already authorized the firearm) but isn't used to gate this
 * query.
 */
export async function listMountedForFirearm(
  actorId: string,
  firearmId: string,
): Promise<Accessory[]> {
  void actorId;
  return db
    .select()
    .from(accessory)
    .where(eq(accessory.currentFirearmId, firearmId))
    .orderBy(asc(accessory.category), asc(accessory.brand));
}

/**
 * Bespoke delete (accessories are not a grant `ParentType`, so
 * `authorizeAndDeleteParent` doesn't apply, and there are no grants to clean
 * up). Owner may always delete; an edit-grantee may delete a mounted
 * accessory too (R9 — delete follows the inherited firearm-edit permission).
 * A view-grantee is forbidden; anything outside the visible set is
 * not-found — this also covers an unmounted, non-owned accessory, which is
 * simply invisible (`resolveAccessoryPermission` returns null for it).
 */
export async function deleteAccessory(
  actorId: string,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireEditPermission(tx, actorId, id);
    const deleted = await tx
      .delete(accessory)
      .where(eq(accessory.id, id))
      .returning({ id: accessory.id });
    if (deleted.length === 0) throw new NotFoundError();
  });
}
