import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listFirearms } from "@/src/domain/firearms/service";
import { listMagazinesFiltered } from "@/src/domain/magazines/filter";
import { getPrefixData } from "@/src/domain/magazines/prefixes";
import {
  calibersForFilter,
  calibersForInput,
} from "@/src/domain/reference/reference";
import { magazineFedOptions } from "./firearm-options";
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

  // UNFILTERED on purpose (#37 KTD6) — see `magazineFedOptions`. An existing
  // compatibility link must still render its firearm's name even when that
  // firearm is no longer magazine-fed.
  const nameById = new Map(firearms.map((f) => [f.id, f.name]));
  const firearmOptions = magazineFedOptions(firearms);

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
    lastInventoriedAt: m.lastInventoriedAt
      ? m.lastInventoriedAt.toISOString()
      : null,
    compatibleFirearmIds: m.compatibleFirearmIds,
    compatibleFirearmNames: m.compatibleFirearmIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => n !== undefined),
  }));

  return (
    <div className="space-y-6">
      <MagazinesView
        magazines={items}
        currentUserId={user.id}
        firearmOptions={firearmOptions}
        hasFirearms={firearms.length > 0}
        caliberSuggestions={caliberSuggestions}
        prefixOptions={prefixData.prefixes}
        prefixNextStart={prefixData.nextStart}
        magpulMode={user.magpulMode}
        filterCalibers={filterCalibers}
      />
    </div>
  );
}
