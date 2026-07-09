/**
 * Shared firearm-mount-context builder for the accessories create and detail
 * pages (CodeRabbit PRRT_kwDOTHOb1M6PHy5a): both pages need the same
 * `firearmNames` lookup and the same "editable firearms" filter for the mount
 * picker, differing only in which owner the picker must match against.
 */

import type { Permission } from "@/src/auth/visibility";
import { firearmDisplayName } from "@/src/domain/firearms/display";
import type { Firearm } from "@/src/domain/firearms/service";

export interface EditableFirearmOption {
  id: string;
  label: string;
}

export interface FirearmMountContext {
  /**
   * Every firearm visible to the actor (owned ∪ shared), id → display name —
   * enough to name a mounted accessory's current firearm even when the actor
   * can't edit it (e.g. it's mounted on a firearm shared to them view-only).
   */
  firearmNames: Record<string, string>;
  /**
   * Firearms the mount picker may offer: owned by `ownerId` AND editable by
   * the actor (owner or edit permission, R17). Callers pass the actor's own
   * id on create (KTD5's same-owner mount guard) or the accessory's current
   * owner id on reassignment (KTD5's cross-tenant guard), so an edit GRANT
   * the actor holds on a firearm they don't own never appears as an option
   * when it would fail `authorizeCreateMount`'s cross-tenant check anyway.
   */
  editableFirearms: EditableFirearmOption[];
}

/**
 * Build the shared mount-picker context for the accessories pages.
 *
 * @param firearms All firearms visible to the actor.
 * @param permissions The actor's permission on each visible firearm.
 * @param ownerId The owner the mount picker's options must match — the
 *   actor's own id on create, or the accessory's owner id on reassignment.
 */
export function buildFirearmMountContext(
  firearms: Firearm[],
  permissions: Map<string, Permission>,
  ownerId: string,
): FirearmMountContext {
  const firearmNames: Record<string, string> = {};
  for (const f of firearms) firearmNames[f.id] = firearmDisplayName(f);

  const editableFirearms: EditableFirearmOption[] = firearms
    .filter((f) => {
      const permission = permissions.get(f.id);
      return (
        f.ownerId === ownerId &&
        (permission === "owner" || permission === "edit")
      );
    })
    .map((f) => ({ id: f.id, label: firearmDisplayName(f) }));

  return { firearmNames, editableFirearms };
}
