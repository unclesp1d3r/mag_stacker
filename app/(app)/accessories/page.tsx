import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { listAccessories } from "@/src/domain/accessories/service";
import { firearmDisplayName } from "@/src/domain/firearms/display";
import { listFirearms } from "@/src/domain/firearms/service";
import { AccessoriesView, type AccessoryListItem } from "./accessories-view";
import type { EditableFirearmOption } from "./accessory-form";

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

  // All firearms visible to the actor (owned ∪ shared) — enough to name a
  // mounted accessory's current firearm even when the actor can't edit it
  // (e.g. it's mounted on a firearm shared to them view-only).
  const firearmNames: Record<string, string> = {};
  for (const f of firearms) firearmNames[f.id] = firearmDisplayName(f);

  // The mount selector only offers firearms the actor can EDIT (owner or
  // edit permission, R17) — a strict subset of `firearms`.
  const editableFirearms: EditableFirearmOption[] = firearms
    .filter((f) => {
      const permission = permissions.get(f.id);
      return permission === "owner" || permission === "edit";
    })
    .map((f) => ({ id: f.id, label: firearmDisplayName(f) }));

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
