import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Stat } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
import { getCurrentUser } from "@/src/auth/session";
import { inventorySummary } from "@/src/domain/summary/summary";

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

      {summary.totalMagazines === 0 && summary.firearmCounts.length === 0 ? (
        <EmptyState
          title="Nothing to summarize yet"
          description="Add magazines to see counts by caliber and by firearm."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total magazines" value={summary.totalMagazines} />
            <Stat label="Calibers" value={summary.byCaliber.length} />
            <Stat label="Firearms" value={summary.firearmCounts.length} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="by-caliber" className="space-y-3">
              <h2 id="by-caliber" className="text-sm font-semibold text-ink">
                By caliber
              </h2>
              <DataTable>
                <THead>
                  <TH>Caliber</TH>
                  <TH className="text-right">Mags</TH>
                  <TH className="text-right">Eff. rounds</TH>
                </THead>
                <tbody>
                  {summary.byCaliber.map((row) => (
                    <TRow key={row.caliber}>
                      <TD className="font-medium tabular">{row.caliber}</TD>
                      <TD className="text-right tabular">{row.count}</TD>
                      <TD className="text-right tabular">
                        {row.effectiveCapacity}
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </DataTable>
            </section>

            <section aria-labelledby="by-firearm" className="space-y-3">
              <h2 id="by-firearm" className="text-sm font-semibold text-ink">
                By firearm
              </h2>
              <DataTable>
                <THead>
                  <TH>Firearm</TH>
                  <TH className="text-right">Compatible mags</TH>
                </THead>
                <tbody>
                  {summary.firearmCounts.map((row) => (
                    <TRow key={row.id}>
                      <TD className="font-medium">{row.name}</TD>
                      <TD className="text-right tabular">{row.count}</TD>
                    </TRow>
                  ))}
                </tbody>
              </DataTable>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
