"use client";

// U8/KTD-8: `page.tsx` stays a server component that hand-aggregates via
// `inventorySummary()`; the aggregate rows it produces are fed straight into
// this thin client wrapper, which layers the shared `DataTable` (sort +
// column show/hide + pagination only — no filter, no grouping, since the
// rows are already aggregated) over each of the two roll-up tables.

import { useMemo } from "react";
import { magazineCountValue } from "@/app/(app)/firearms/magazine-count";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { Data } from "@/components/ui/typography";
import { useTableViewState } from "@/hooks/use-table-view-state";
import type { BacklogRow } from "@/src/domain/service-intervals/backlog";
import type {
  CaliberCoverage,
  CaliberSummary,
  FirearmCount,
} from "@/src/domain/summary/summary";
import { ServiceBacklogControl } from "./service-backlog-control";

interface SummaryTablesProps {
  byCaliber: CaliberSummary[];
  firearmCounts: FirearmCount[];
  caliberCoverage: CaliberCoverage[];
  /** Visible items with at least one due service rule (U9, R19). */
  itemsDue: number;
  /** Total due service rules across the visible collection (U9, R19). */
  rulesDue: number;
  /** One row per due item-and-rule pair (R16) — feeds the bulk mark-serviced control. */
  serviceBacklog: BacklogRow[];
}

/** Visible text for each `CaliberCoverage.reason` (R12) — never color alone. */
const COVERAGE_REASON_LABEL: Record<CaliberCoverage["reason"], string> = {
  "no-ammo": "No ammo",
  "low-stock-only": "Low stock only",
};

export function SummaryTables({
  byCaliber,
  firearmCounts,
  caliberCoverage,
  itemsDue,
  rulesDue,
  serviceBacklog,
}: SummaryTablesProps) {
  const caliberColumns = useMemo<ColumnDef<CaliberSummary>[]>(
    () => [
      {
        accessorKey: "caliber",
        id: "caliber",
        header: "Caliber",
        meta: { label: "Caliber" },
        cell: ({ getValue }) => (
          <Data className="font-medium">{getValue<string>()}</Data>
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
        // Same treatment as the firearms table's "# Mags" column (#37 R8/R9),
        // via the shared helper so the two can never drift apart.
        cell: ({ row }) =>
          magazineCountValue(row.original.isMagazineFed, row.original.count),
      },
    ],
    [],
  );

  const coverageColumns = useMemo<ColumnDef<CaliberCoverage>[]>(
    () => [
      {
        accessorKey: "caliber",
        id: "caliber",
        header: "Caliber",
        meta: { label: "Caliber" },
        cell: ({ getValue }) => (
          <Data className="font-medium">{getValue<string>()}</Data>
        ),
      },
      {
        accessorKey: "reason",
        id: "reason",
        header: "Reason",
        meta: { label: "Reason" },
        cell: ({ getValue }) =>
          COVERAGE_REASON_LABEL[getValue<CaliberCoverage["reason"]>()],
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
  const coverageView = useTableViewState(
    "summary-caliber-coverage",
    createDefaultTableViewState(coverageColumns),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* U9/R19: breadth (items) and volume (rules) from one line, beside the
          ammo low-stock roll-up below — never re-derives due state, only
          reads the counts `computeServiceRollup` already folded into
          `Summary`. */}
      <section
        aria-labelledby="service-due"
        className="space-y-3 lg:col-span-2"
      >
        <h2 id="service-due" className="text-sm font-semibold text-foreground">
          Service
        </h2>
        <Data>
          {itemsDue} {itemsDue === 1 ? "item" : "items"} due for service across{" "}
          {rulesDue} {rulesDue === 1 ? "rule" : "rules"}
        </Data>
        <ServiceBacklogControl backlog={serviceBacklog} />
      </section>

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

      <section
        aria-labelledby="caliber-coverage"
        className="space-y-3 lg:col-span-2"
      >
        <h2
          id="caliber-coverage"
          className="text-sm font-semibold text-foreground"
        >
          Caliber coverage
        </h2>
        <DataTable
          columns={coverageColumns}
          data={caliberCoverage}
          viewState={coverageView.viewState}
          onViewStateChange={coverageView.setViewState}
          mounted={coverageView.mounted}
        />
      </section>
    </div>
  );
}
