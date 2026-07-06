"use client";

// U8/KTD-8: `page.tsx` stays a server component that hand-aggregates via
// `computeSummary()`; the aggregate rows it produces are fed straight into
// this thin client wrapper, which layers the shared `DataTable` (sort +
// column show/hide + pagination only — no filter, no grouping, since the
// rows are already aggregated) over each of the two roll-up tables.

import { useMemo } from "react";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { useTableViewState } from "@/hooks/use-table-view-state";
import type {
  CaliberSummary,
  FirearmCount,
} from "@/src/domain/summary/summary";

interface SummaryTablesProps {
  byCaliber: CaliberSummary[];
  firearmCounts: FirearmCount[];
}

export function SummaryTables({
  byCaliber,
  firearmCounts,
}: SummaryTablesProps) {
  const caliberColumns = useMemo<ColumnDef<CaliberSummary>[]>(
    () => [
      {
        accessorKey: "caliber",
        id: "caliber",
        header: "Caliber",
        meta: { label: "Caliber" },
        cell: ({ getValue }) => (
          <span className="font-medium tabular">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "count",
        id: "count",
        header: "Mags",
        meta: { numeric: true, label: "Mags" },
      },
      {
        accessorKey: "effectiveCapacity",
        id: "effectiveCapacity",
        header: "Eff. rounds",
        meta: { numeric: true, label: "Eff. rounds" },
      },
    ],
    [],
  );

  const firearmColumns = useMemo<ColumnDef<FirearmCount>[]>(
    () => [
      {
        accessorKey: "name",
        id: "name",
        header: "Firearm",
        meta: { label: "Firearm" },
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "count",
        id: "count",
        header: "Compatible mags",
        meta: { numeric: true, label: "Compatible mags" },
      },
    ],
    [],
  );

  const caliberView = useTableViewState(
    "summary-caliber",
    createDefaultTableViewState(caliberColumns),
  );
  const firearmView = useTableViewState(
    "summary-firearm",
    createDefaultTableViewState(firearmColumns),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="by-caliber" className="space-y-3">
        <h2 id="by-caliber" className="text-sm font-semibold text-foreground">
          By caliber
        </h2>
        <DataTable
          columns={caliberColumns}
          data={byCaliber}
          viewState={caliberView.viewState}
          onViewStateChange={caliberView.setViewState}
          mounted={caliberView.mounted}
        />
      </section>

      <section aria-labelledby="by-firearm" className="space-y-3">
        <h2 id="by-firearm" className="text-sm font-semibold text-foreground">
          By firearm
        </h2>
        <DataTable
          columns={firearmColumns}
          data={firearmCounts}
          viewState={firearmView.viewState}
          onViewStateChange={firearmView.setViewState}
          mounted={firearmView.mounted}
        />
      </section>
    </div>
  );
}
