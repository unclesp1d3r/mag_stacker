import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listFirearms } from "@/src/domain/firearms/service";
import { listMagazinesFiltered } from "@/src/domain/magazines/filter";
import { getPrefixData } from "@/src/domain/magazines/prefixes";
import {
  calibersForFilter,
  calibersForInput,
} from "@/src/domain/reference/reference";
import { ExportButton } from "./export-button";
import type { FirearmOption } from "./magazine-form";
import { type MagazineListItem, MagazinesView } from "./magazines-view";

export default async function MagazinesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [magazines, firearms, caliberSuggestions, filterCalibers, prefixData] =
    await Promise.all([
      listMagazinesFiltered(user.id, {}),
      listFirearms(user.id),
      calibersForInput(db, user.id),
      calibersForFilter(db, user.id),
      getPrefixData(user.id),
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

  // Export only makes sense once there's inventory. On a truly empty account,
  // the cold-start guidance carries the screen alone — no controls competing
  // with the one path forward. Filtering now lives in the view's own toolbar.
  const showControls = items.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Magazines"
        description="Search, filter, add, and export your magazines."
        actions={showControls ? <ExportButton /> : undefined}
      />
      <MagazinesView
        magazines={items}
        currentUserId={user.id}
        firearmOptions={firearmOptions}
        caliberSuggestions={caliberSuggestions}
        prefixOptions={prefixData.prefixes}
        prefixNextStart={prefixData.nextStart}
        magpulMode={user.magpulMode}
        filterCalibers={filterCalibers}
      />
    </div>
  );
}
