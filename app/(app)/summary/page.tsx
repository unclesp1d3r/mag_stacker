import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Stat } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { accessoryDisplayName } from "@/src/domain/accessories/display";
import { listAccessories } from "@/src/domain/accessories/service";
import { firearmDisplayName } from "@/src/domain/firearms/display";
import { listFirearms } from "@/src/domain/firearms/service";
import { buildServiceBacklog } from "@/src/domain/service-intervals/backlog";
import { listDueForVisibleCollection } from "@/src/domain/service-intervals/due-service";
import { inventorySummary } from "@/src/domain/summary/summary";
import { SummaryTables } from "./summary-tables";

export default async function SummaryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Loaded once and reused for the roll-up counts AND the bulk mark-serviced
  // control's backlog (R16) — `inventorySummary` would otherwise re-run
  // `listDueForVisibleCollection`'s own batched pipeline a second time
  // (KTD4), mirroring how `firearms/page.tsx` already reuses these loads.
  const [firearms, accessories, firearmPermissions] = await Promise.all([
    listFirearms(user.id),
    listAccessories(user.id),
    visibleFirearmPermissions(db, user.id),
  ]);
  const dueEntries = await listDueForVisibleCollection(
    user.id,
    undefined,
    firearms,
  );
  const summary = await inventorySummary(user.id, dueEntries, firearms);
  // The bulk mark-serviced checklist is a WRITE surface: a firearm
  // view-grantee can see the owner's due state in the roll-up above (that's
  // legitimate, unchanged), but `logServiceEventsBulk` never lets them log
  // service (KTD3), so they must never be offered a checkbox for it.
  const actionableFirearmIds = new Set(
    [...firearmPermissions.entries()]
      .filter(([, perm]) => perm === "owner" || perm === "edit")
      .map(([id]) => id),
  );
  const serviceBacklog = buildServiceBacklog(
    dueEntries,
    new Map(firearms.map((f) => [f.id, firearmDisplayName(f)])),
    new Map(accessories.map((a) => [a.id, accessoryDisplayName(a)])),
    actionableFirearmIds,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Summary"
        description="A roll-up of the inventory visible to you."
      />

      {summary.totalMagazines === 0 &&
      summary.firearmCounts.length === 0 &&
      summary.totalAmmoLots === 0 &&
      summary.itemsDue === 0 ? (
        <EmptyState
          title="Nothing to summarize yet"
          description="Add firearms, magazines, or ammo to see counts by caliber, by firearm, and low-stock roll-ups."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total magazines" value={summary.totalMagazines} />
            <Stat label="Calibers" value={summary.byCaliber.length} />
            <Stat label="Firearms" value={summary.firearmCounts.length} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total ammo lots" value={summary.totalAmmoLots} />
            <Stat label="Ammo lots low" value={summary.ammoEntriesLow} />
            <Stat label="Calibers low" value={summary.ammoCalibersLow} />
          </div>

          <SummaryTables
            byCaliber={summary.byCaliber}
            firearmCounts={summary.firearmCounts}
            caliberCoverage={summary.caliberCoverage}
            itemsDue={summary.itemsDue}
            rulesDue={summary.rulesDue}
            serviceBacklog={serviceBacklog}
          />
        </>
      )}
    </div>
  );
}
