import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listFirearms } from "@/src/domain/firearms/service";
import { listMagazinesFiltered } from "@/src/domain/magazines/filter";
import {
  calibersForFilter,
  calibersForInput,
} from "@/src/domain/reference/reference";
import { ExportButton } from "./export-button";
import { FilterBar } from "./filter-bar";
import type { FirearmOption } from "./magazine-form";
import { type MagazineListItem, MagazinesView } from "./magazines-view";

interface PageProps {
  searchParams: Promise<{ q?: string; caliber?: string; firearm?: string }>;
}

export default async function MagazinesPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const filter = {
    brandModel: params.q,
    caliber: params.caliber,
    compatibleFirearmId: params.firearm,
  };

  const [magazines, firearms, caliberSuggestions, filterCalibers] =
    await Promise.all([
      listMagazinesFiltered(user.id, filter),
      listFirearms(user.id),
      calibersForInput(db, user.id),
      calibersForFilter(db, user.id),
    ]);

  const nameById = new Map(firearms.map((f) => [f.id, f.name]));
  const nameCounts = new Map<string, number>();
  for (const f of firearms)
    nameCounts.set(f.name, (nameCounts.get(f.name) ?? 0) + 1);
  const firearmOptions: FirearmOption[] = firearms.map((f) => ({
    id: f.id,
    name: f.name,
    // Disambiguate same-named firearms with a non-sensitive id fragment (R52).
    hint: (nameCounts.get(f.name) ?? 0) > 1 ? f.id.slice(0, 6) : undefined,
  }));

  const items: MagazineListItem[] = magazines.map((m) => ({
    id: m.id,
    ownerId: m.ownerId,
    brandModel: m.brandModel,
    caliber: m.caliber,
    baseCapacity: m.baseCapacity,
    extensionRounds: m.extensionRounds,
    label: m.label,
    acquiredDate: m.acquiredDate,
    notes: m.notes,
    compatibleFirearmIds: m.compatibleFirearmIds,
    compatibleFirearmNames: m.compatibleFirearmIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => n !== undefined),
  }));

  const filtered = Boolean(params.q || params.caliber || params.firearm);
  // Filtering and export only make sense once there's inventory (or an active
  // filter to clear). On a truly empty account, the cold-start guidance carries
  // the screen alone — no controls competing with the one path forward.
  const showControls = items.length > 0 || filtered;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Magazines"
        description="Search, filter, add, and export your magazines."
        actions={showControls ? <ExportButton /> : undefined}
      />
      {showControls ? (
        <Suspense fallback={null}>
          <FilterBar
            calibers={filterCalibers}
            firearmOptions={firearmOptions}
          />
        </Suspense>
      ) : null}
      <MagazinesView
        magazines={items}
        currentUserId={user.id}
        firearmOptions={firearmOptions}
        caliberSuggestions={caliberSuggestions}
        filtered={filtered}
      />
    </div>
  );
}
