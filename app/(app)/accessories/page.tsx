import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { listAccessories } from "@/src/domain/accessories/service";
import { buildFirearmMountContext } from "@/src/domain/firearms/mount-options";
import { listFirearms } from "@/src/domain/firearms/service";
import { AccessoriesView, type AccessoryListItem } from "./accessories-view";

interface PageProps {
  searchParams: Promise<{ mountFirearm?: string }>;
}

export default async function AccessoriesPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { mountFirearm } = await searchParams;

  const [accessories, firearms, permissions] = await Promise.all([
    listAccessories(user.id),
    listFirearms(user.id),
    visibleFirearmPermissions(db, user.id),
  ]);

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
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accessories"
        description="Track parts, where they're mounted, cost, and NFA status."
      />
      <AccessoriesView
        accessories={items}
        currentUserId={user.id}
        editableFirearms={editableFirearms}
        firearmNames={firearmNames}
        initialMountFirearmId={initialMountFirearmId}
      />
    </div>
  );
}
