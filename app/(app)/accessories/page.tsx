import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/auth/session";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { listAccessories } from "@/src/domain/accessories/service";
import { buildFirearmMountContext } from "@/src/domain/firearms/mount-options";
import { listFirearms } from "@/src/domain/firearms/service";
import {
  dueParentIds,
  listDueForVisibleCollection,
} from "@/src/domain/service-intervals/due-service";
import { listOwnerAccessoryCategories } from "@/src/domain/service-intervals/rules-service";
import { AccessoriesView, type AccessoryListItem } from "./accessories-view";

interface PageProps {
  searchParams: Promise<{ mountFirearm?: string }>;
}

export default async function AccessoriesPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { mountFirearm } = await searchParams;

  const [accessories, firearms, permissions, ownerCategories] =
    await Promise.all([
      listAccessories(user.id),
      listFirearms(user.id),
      visibleFirearmPermissions(db, user.id),
      // Suggestions only (KD10 stays exact-string free text) — reuses the
      // defaults surface's KTD8 query rather than duplicating it. On create,
      // the actor IS the new accessory's owner (this UI never collects an
      // on-behalf `ownerId`), so the actor's own categories are the right set.
      listOwnerAccessoryCategories(user.id),
    ]);
  // U9/R20: bounded (never per-item, KTD4) — marks rows with at least one due
  // service rule of their own (never merely because a mounting firearm is
  // due). Passes the already-fetched `firearms` through — `listFirearms`'s
  // visible-firearm scope here matches this page's own fetch above, so
  // `listDueForVisibleCollection` doesn't need to re-run it. (Deliberately
  // NOT threading `accessories` — its scope there is owner-only, KTD3,
  // narrower than this page's mount-inheriting `listAccessories`.)
  const dueEntries = await listDueForVisibleCollection(
    user.id,
    undefined,
    firearms,
  );
  const dueAccessoryIds = dueParentIds(dueEntries, "accessory");

  // On create, the accessory's owner is the actor themself (KTD5's
  // same-owner mount guard), so a firearm the actor merely has an edit GRANT
  // on — but doesn't own — would pass permission but fail
  // `authorizeCreateMount`'s cross-tenant check at submit; excluding it here
  // keeps the picker's options a strict subset of what will actually save.
  const { firearmNames, editableFirearms } = buildFirearmMountContext(
    firearms,
    permissions,
    user.id,
  );

  // Honor a pre-fill target from a firearm's "Add accessory" link (F1) only
  // when the actor can actually mount to it.
  const initialMountFirearmId = editableFirearms.some(
    (f) => f.id === mountFirearm,
  )
    ? mountFirearm
    : undefined;

  const items: AccessoryListItem[] = accessories.map((a) => ({
    id: a.id,
    ownerId: a.ownerId,
    category: a.category,
    brand: a.brand,
    model: a.model,
    installedDate: a.installedDate,
    costCents: a.costCents,
    notes: a.notes,
    isNfa: a.isNfa,
    currentFirearmId: a.currentFirearmId,
    serviceDue: dueAccessoryIds.has(a.id),
  }));

  return (
    <div className="space-y-6">
      <AccessoriesView
        accessories={items}
        currentUserId={user.id}
        editableFirearms={editableFirearms}
        firearmNames={firearmNames}
        initialMountFirearmId={initialMountFirearmId}
        ownerCategories={ownerCategories}
      />
    </div>
  );
}
