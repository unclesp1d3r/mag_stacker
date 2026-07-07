import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Stat } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { inventorySummary } from "@/src/domain/summary/summary";
import { SummaryTables } from "./summary-tables";

export default async function SummaryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const summary = await inventorySummary(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Summary"
        description="A roll-up of the inventory visible to you."
      />

      {summary.totalMagazines === 0 &&
      summary.firearmCounts.length === 0 &&
      summary.totalAmmoLots === 0 ? (
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
          />
        </>
      )}
    </div>
  );
}
