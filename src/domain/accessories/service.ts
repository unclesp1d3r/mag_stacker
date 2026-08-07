import { asc, eq, inArray } from "drizzle-orm";
import {
  authorizeMount,
  listVisibleAccessoryIds,
  requireAccessoryDelete,
  requireAccessoryEdit,
  resolveAccessoryPermission,
} from "@/src/auth/accessory-visibility";
import { authorizeUpdate, resolveCreateOwner } from "@/src/auth/authorize";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { getVisibleIds, type Permission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { accessory, firearm } from "@/src/db/schema";
import { ValidationError } from "../errors";
import {
  loadAccessoryCompatibilityBatch,
  replaceAccessoryCompatibility,
} from "./compatibility";
import type { AccessoryType } from "./constants";
import { type AccessoryFields, validateAccessory } from "./validate";

/**
 * Accessory service (U4). Visibility-scoped CRUD plus mount/reassign/unmount,
 * mirroring `src/domain/ammo/service.ts`'s shape.
 *
 * Accessories became a grant `ParentType` in #23, but they still do NOT route
 * through the shared `authorize.ts` gates: an accessory's permission is the
 * strongest of its direct grant and the firearm it is mounted to, which only
 * `resolveAccessoryPermission` knows how to combine. So every read/write here
 * goes through `src/auth/accessory-visibility.ts` instead, and deletes stay
 * bespoke rather than using `authorizeAndDeleteParent`.
 * Validation runs before any write (R8); raw values are persisted (R18)
 * except where noted.
 */

export type Accessory = typeof accessory.$inferSelect;

/**
 * An accessory plus the firearms it is declared COMPATIBLE with (#23 R4) —
 * "which hosts does this fit". Not to be confused with `currentFirearmId` on
 * the row itself, which is the single firearm it is mounted to right now. The
 * two are independent by design (R6).
 */
export type AccessoryWithCompatibility = Accessory & {
  compatibleFirearmIds: string[];
};

export interface AccessoryInput extends AccessoryFields {
  /** Optional brand/model/serial/notes; empty-not-null when omitted (R18). */
  brand?: string;
  model?: string;
  serialNumber?: string;
  notes?: string;
  /**
   * The firearms this accessory FITS (#23 R4) — replaced wholesale on every
   * write, mirroring magazines. Omitted is treated as an empty set on create
   * and as "clear it" on update, exactly as `replaceCompatibility` behaves for
   * magazines, so the two surfaces cannot diverge.
   */
  compatibleFirearmIds?: string[];
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
    // `type` arrives as free `string` (it is user input) but every caller runs
    // `validateAccessory` first and throws on a value outside the controlled
    // set, so the narrowing the column demands is already established here.
    type: input.type as AccessoryType,
    // `category` is trimmed so the list view's exact-match category grouping
    // can't be split by incidental leading/trailing whitespace. Optional since
    // #23 R3 — omitted means empty, not "unclassified", because `type` now
    // carries the classification.
    category: (input.category ?? "").trim(),
    brand: input.brand ?? "",
    model: input.model ?? "",
    serialNumber: input.serialNumber ?? "",
    installedDate: mountedFirearmId ? (input.installedDate ?? null) : null,
    // Added during implementation, mirroring `firearm.acquiredDate` (R22):
    // null means unset, not "unknown but zero" — the service-interval origin
    // date (KTD9) depends on that distinction. Unlike `installedDate`, this
    // is NOT force-nulled on unmount — it records when the OWNER acquired
    // the accessory, not when it was last mounted.
    acquiredDate: input.acquiredDate ?? null,
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

/** Attach viewer-relative compatibility (ordinal order, unseen firearms dropped). */
async function attachCompatibility(
  database: DbOrTx,
  actorId: string,
  rows: Accessory[],
  precomputedVisibleFirearmIds?: Set<string>,
): Promise<AccessoryWithCompatibility[]> {
  if (rows.length === 0) return [];
  const visibleFirearms =
    precomputedVisibleFirearmIds ??
    (await getVisibleIds(database, actorId, "firearm"));
  const byAccessory = await loadAccessoryCompatibilityBatch(
    database,
    visibleFirearms,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    compatibleFirearmIds: byAccessory.get(r.id) ?? [],
  }));
}

export async function createAccessory(
  actorId: string,
  input: AccessoryCreateInput,
): Promise<AccessoryWithCompatibility> {
  const codes = validateAccessory(input);
  if (codes.length > 0) throw new ValidationError(codes);

  const row = await db.transaction(async (tx) => {
    const ownerId = await resolveCreateOwner(tx, actorId, input.ownerId);

    // Normalize the mount target once so the authorization guard and the
    // persisted value can never disagree: an empty-string `firearmId` is
    // treated as unmounted everywhere, never persisted into the uuid FK.
    const mountedFirearmId = input.firearmId || null;
    if (mountedFirearmId) {
      await authorizeCreateMount(tx, actorId, ownerId, mountedFirearmId);
    }

    const [created] = await tx
      .insert(accessory)
      .values({
        ownerId,
        currentFirearmId: mountedFirearmId,
        ...persistableFields(input, mountedFirearmId),
      })
      .returning();
    // A firearm the actor cannot see throws here, rolling back the insert too.
    await replaceAccessoryCompatibility(
      tx,
      actorId,
      created.id,
      input.compatibleFirearmIds ?? [],
    );
    return created;
  });
  const [withCompat] = await attachCompatibility(db, actorId, [row]);
  return withCompat;
}

export async function updateAccessory(
  actorId: string,
  id: string,
  input: AccessoryUpdateInput,
): Promise<AccessoryWithCompatibility> {
  const codes = validateAccessory(input);
  if (codes.length > 0) throw new ValidationError(codes);

  const row = await db.transaction(async (tx) => {
    await requireAccessoryEdit(tx, actorId, id);
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
    const [updated] = await tx
      .update(accessory)
      .set({
        ...persistableFields(input, existing.currentFirearmId),
        updatedAt: new Date(),
      })
      .where(eq(accessory.id, id))
      .returning();
    if (!updated) throw new NotFoundError();
    // A bad/unseeable link throws here, rolling back the scalar update too.
    await replaceAccessoryCompatibility(
      tx,
      actorId,
      id,
      input.compatibleFirearmIds ?? [],
    );
    return updated;
  });
  const [withCompat] = await attachCompatibility(db, actorId, [row]);
  return withCompat;
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
  /** See `listFirearms` — lets a caller that already holds the set skip a query. */
  precomputedVisibleFirearmIds?: Set<string>,
): Promise<{ accessory: AccessoryWithCompatibility; permission: Permission }> {
  const permission = await resolveAccessoryPermission(db, actorId, id);
  if (permission === null) throw new NotFoundError();
  const [row] = await db
    .select()
    .from(accessory)
    .where(eq(accessory.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  const [withCompat] = await attachCompatibility(
    db,
    actorId,
    [row],
    precomputedVisibleFirearmIds,
  );
  // Return the viewer's permission alongside the row so the caller doesn't
  // re-resolve it (one query, and no read-vs-permission race between two calls).
  return { accessory: withCompat, permission };
}

/**
 * Owned + mounted-on-visible-firearm accessories ordered by category, then
 * brand (ascending); always an array (R68-style).
 */
export async function listAccessories(
  actorId: string,
  /** See `listFirearms` — lets a caller that already holds the set skip a query. */
  precomputedVisibleFirearmIds?: Set<string>,
): Promise<AccessoryWithCompatibility[]> {
  // Derive the visible firearm set ONCE and thread it through both consumers:
  // the inherited-visibility path needs it, and so does the viewer-relative
  // compatibility filter. Without this the list page pays for the same set
  // twice on every load.
  const visibleFirearms =
    precomputedVisibleFirearmIds ??
    (await getVisibleIds(db, actorId, "firearm"));
  const visible = await listVisibleAccessoryIds(db, actorId, visibleFirearms);
  if (visible.size === 0) return [];
  const rows = await db
    .select()
    .from(accessory)
    .where(inArray(accessory.id, [...visible]))
    .orderBy(asc(accessory.category), asc(accessory.brand));
  return attachCompatibility(db, actorId, rows, visibleFirearms);
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
 * Bespoke delete: `authorizeAndDeleteParent` resolves permission the generic
 * way and would miss the mounted-firearm inheritance, so it does not apply
 * even now that accessories are a grant `ParentType`. Grant rows are cleaned
 * up by the `accessory_grants_cleanup` trigger (#23 R10, migration 0022)
 * rather than in this transaction.
 *
 * Delete is gated more tightly than update — see `requireAccessoryDelete`: the
 * owner and #8's firearm-edit-inheritance path may delete, but a direct #23
 * accessory `edit` grant may not, matching how every other grantable parent
 * type treats sharing at edit.
 * A view-grantee is forbidden; anything outside the visible set is
 * not-found — this also covers an unmounted, non-owned accessory, which is
 * simply invisible (`resolveAccessoryPermission` returns null for it).
 */
export async function deleteAccessory(
  actorId: string,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireAccessoryDelete(tx, actorId, id);
    const deleted = await tx
      .delete(accessory)
      .where(eq(accessory.id, id))
      .returning({ id: accessory.id });
    if (deleted.length === 0) throw new NotFoundError();
  });
}
