"use client";

import { useMemo } from "react";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { Data } from "@/components/ui/typography";
import { useTableViewState } from "@/hooks/use-table-view-state";

/**
 * An item's service history (U8, R17) — every service event, newest first,
 * naming the rule it serviced. Server-loaded and passed in as a prop (the
 * detail page already loads it alongside the resolved rules in one
 * `Promise.all`, mirroring how `photos`/`documents` are loaded rather than
 * fetched client-side); `router.refresh()` after a log-service mutation
 * (wired by the parent detail view, matching `RangeSessionHistory`'s
 * `onChange` convention) re-runs the page and passes a fresh list down.
 */

export interface ServiceHistoryEntry {
  id: string;
  ruleName: string;
  servicedOn: string;
  actorName: string;
  notes: string;
}

interface ServiceHistoryProps {
  entries: ServiceHistoryEntry[];
}

export function ServiceHistory({ entries }: ServiceHistoryProps) {
  const columns = useMemo<ColumnDef<ServiceHistoryEntry>[]>(
    () => [
      {
        accessorKey: "servicedOn",
        id: "servicedOn",
        header: "Date",
        meta: { label: "Date" },
        cell: ({ getValue }) => <Data>{getValue<string>()}</Data>,
      },
      {
        accessorKey: "ruleName",
        id: "ruleName",
        header: "Rule",
        meta: { label: "Rule" },
      },
      {
        accessorKey: "actorName",
        id: "actorName",
        header: "Serviced by",
        meta: { label: "Serviced by" },
      },
      {
        accessorKey: "notes",
        id: "notes",
        header: "Notes",
        meta: { label: "Notes" },
        cell: ({ getValue }) => (
          <span className="text-ink-soft">{getValue<string>()}</span>
        ),
      },
    ],
    [],
  );

  const { viewState, setViewState, mounted } = useTableViewState(
    "service-history",
    createDefaultTableViewState(columns),
  );

  return (
    <Card role="region" aria-label="Service history">
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        Service history
      </h2>
      {entries.length === 0 ? (
        <EmptyState
          title="No service logged yet"
          description="Logged service against any rule will appear here, newest first."
        />
      ) : (
        <DataTable
          columns={columns}
          data={entries}
          viewState={viewState}
          onViewStateChange={setViewState}
          mounted={mounted}
        />
      )}
    </Card>
  );
}
