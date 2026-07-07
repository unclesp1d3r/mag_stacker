"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { useTableViewState } from "@/hooks/use-table-view-state";
import type { ParentType } from "@/src/auth/visibility";
import {
  FIREARM_LOG_EVENTS,
  MAGAZINE_LOG_EVENTS,
} from "@/src/domain/inventory-log/constants";
import {
  type LogEntryWithActor,
  listLogAction,
  markInventoriedAction,
} from "./log-actions";
import { eventTypeLabel, LogEntryForm } from "./log-entry-form";

interface InventoryLogHistoryProps {
  parentType: ParentType;
  parentId: string;
  /** True when the actor may log events / mark inventoried for this parent (R10/R11). */
  canEdit: boolean;
  /** Called after a log/mark-inventoried so the parent can refresh anything it derives. */
  onChange?: () => void;
}

/** Local, human-readable timestamp — date + time, no seconds (R9). */
function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Inventory-log Card (U4, R9-R11): a chronological, newest-first list of a
 * firearm's or magazine's log entries, with both quick affordances —
 * "Mark inventoried" and "Log…" — co-located in the header so a single
 * `load()` path refreshes the list after either one. Mirrors
 * `range-session-history.tsx`'s structure closely.
 */
export function InventoryLogHistory({
  parentType,
  parentId,
  canEdit,
  onChange,
}: InventoryLogHistoryProps) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<LogEntryWithActor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, startLoad] = useTransition();
  const [marking, startMark] = useTransition();

  const load = useCallback(() => {
    setError(null);
    startLoad(async () => {
      const result = await listLogAction(parentType, parentId);
      if (result.ok) {
        setEntries(result.data?.entries ?? []);
      } else {
        setError(result.error ?? "Could not load log entries.");
        setEntries([]);
      }
    });
  }, [parentType, parentId]);

  // Load on mount and whenever the parent changes.
  useEffect(() => {
    load();
  }, [load]);

  function afterMutation() {
    setFormOpen(false);
    load();
    onChange?.();
  }

  function onMarkInventoried() {
    startMark(async () => {
      const result = await markInventoriedAction(parentType, parentId);
      if (result.ok) {
        toast({ message: "Marked inventoried" });
        // Same reload path as the form — the new entry appears at the top
        // without a manual page reload.
        load();
        onChange?.();
      } else {
        toast({
          message: result.error ?? "Could not mark inventoried.",
          tone: "destructive",
        });
      }
    });
  }

  const eventTypes =
    parentType === "firearm" ? FIREARM_LOG_EVENTS : MAGAZINE_LOG_EVENTS;

  const list = entries ?? [];

  // Memoized per the react-compiler autoreset pitfall (known in this repo):
  // an unmemoized columns/data array fed to useReactTable can hit a render loop.
  const columns = useMemo<ColumnDef<LogEntryWithActor>[]>(
    () => [
      {
        accessorKey: "eventType",
        id: "eventType",
        header: "Event",
        meta: { label: "Event" },
        cell: ({ getValue }) => eventTypeLabel(getValue<string>()),
      },
      {
        accessorKey: "actorName",
        id: "actor",
        header: "Actor",
        meta: { label: "Actor" },
        cell: ({ getValue }) => getValue<string>(),
      },
      {
        accessorKey: "occurredAt",
        id: "occurredAt",
        header: "Timestamp",
        meta: { label: "Timestamp" },
        cell: ({ getValue }) => (
          <span className="tabular">
            {formatTimestamp(getValue<Date | string>())}
          </span>
        ),
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
    "inventory-log-history",
    createDefaultTableViewState(columns),
  );

  function renderBody() {
    if (loading && entries === null) {
      return (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner /> Loading log…
        </p>
      );
    }
    if (error) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="ghost" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <EmptyState
          title="No log entries"
          description={
            canEdit
              ? "Log an event or mark this item inventoried to start its history."
              : `No inventory events have been logged for this ${parentType}.`
          }
        />
      );
    }
    return (
      <DataTable
        columns={columns}
        data={list}
        viewState={viewState}
        onViewStateChange={setViewState}
        mounted={mounted}
      />
    );
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Inventory log</h2>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkInventoried}
              disabled={marking}
            >
              {marking ? "Marking…" : "Mark inventoried"}
            </Button>
            <Button size="sm" onClick={() => setFormOpen((open) => !open)}>
              {formOpen ? "Cancel" : "Log…"}
            </Button>
          </div>
        ) : null}
      </div>

      {formOpen ? (
        <div className="mb-4 rounded-md border border-input p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">
            New log entry
          </h3>
          <LogEntryForm
            parentType={parentType}
            parentId={parentId}
            eventTypes={eventTypes}
            onDone={afterMutation}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      ) : null}

      {renderBody()}
    </Card>
  );
}
