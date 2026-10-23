"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { Badge, EmptyState, Spinner } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { Data } from "@/components/ui/typography";
import { useTableViewState } from "@/hooks/use-table-view-state";
import { formatTimestamp } from "../inventory-log/inventory-log-history";
import {
  type LogEntryWithActor,
  listLogAction,
} from "../inventory-log/log-actions";
import { ReconcileForm } from "./reconcile-form";
import { computeVariance, formatVariance, isCountApplied } from "./variance";

interface ReconcileHistoryProps {
  ammoId: string;
  /** True when the actor may reconcile this lot (owner or edit grantee, R8). */
  canEdit: boolean;
  /** The lot's quantity on record — the form preview's baseline (R12). */
  quantityOnRecord: number;
  /** Called after a reconcile so the parent refreshes the quantity and Low Stock (R14). */
  onChange?: () => void;
}

/** A history row with its derived display fields attached once, memoized. */
interface HistoryRow extends LogEntryWithActor {
  variance: number;
  applied: boolean;
}

/**
 * Reconciliation history card for an ammo lot (#100 U4, R13). A sibling of
 * `InventoryLogHistory` rather than a branch of it (KTD6): it shares the
 * read action and timestamp formatting but owns the ammo columns (Counted,
 * Variance) and the Reconcile form. Newest first; append-only (R10).
 */
export function ReconcileHistory({
  ammoId,
  canEdit,
  quantityOnRecord,
  onChange,
}: ReconcileHistoryProps) {
  const [entries, setEntries] = useState<LogEntryWithActor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, startLoad] = useTransition();
  // Discard a slower, superseded response after the lot changes (mirrors
  // `InventoryLogHistory`).
  const activeRequestRef = useRef<string | null>(null);

  const load = useCallback(() => {
    activeRequestRef.current = ammoId;
    setError(null);
    startLoad(async () => {
      const result = await listLogAction("ammo", ammoId);
      if (activeRequestRef.current !== ammoId) return;
      if (result.ok) {
        setEntries(result.data?.entries ?? []);
      } else {
        setError(result.error ?? "Could not load reconciliation history.");
        setEntries([]);
      }
    });
  }, [ammoId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Reload our own rows first, then let the parent refresh the lot (R14). */
  function afterReconcile() {
    setFormOpen(false);
    load();
    onChange?.();
  }

  // Memoized per the react-compiler autoreset pitfall: an unmemoized data
  // array fed to useReactTable can hit a render loop.
  const rows = useMemo<HistoryRow[]>(() => {
    const list = entries ?? [];
    return list.map((e) => ({
      ...e,
      variance: computeVariance(e.countedRounds ?? 0, e.recordedRounds ?? 0),
      applied: isCountApplied(e, list),
    }));
  }, [entries]);

  const columns = useMemo<ColumnDef<HistoryRow>[]>(
    () => [
      {
        accessorKey: "occurredAt",
        id: "occurredAt",
        header: "Timestamp",
        meta: { label: "Timestamp" },
        cell: ({ getValue }) => (
          <Data>{formatTimestamp(getValue<Date | string>())}</Data>
        ),
      },
      {
        accessorKey: "actorName",
        id: "actor",
        header: "Actor",
        meta: { label: "Actor" },
        cell: ({ getValue }) => getValue<string>(),
      },
      {
        accessorKey: "countedRounds",
        id: "counted",
        header: "Counted",
        meta: { numeric: true, label: "Counted" },
        cell: ({ row }) => (
          <span className="inline-flex items-center justify-end gap-2">
            <Data>{row.original.countedRounds}</Data>
            {row.original.applied ? null : (
              <Badge tone="primary">Not applied</Badge>
            )}
          </span>
        ),
      },
      {
        accessorKey: "variance",
        id: "variance",
        header: "Variance",
        meta: { numeric: true, label: "Variance" },
        cell: ({ getValue }) => (
          <Data>{formatVariance(getValue<number>())}</Data>
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
    "ammo-reconcile-history",
    createDefaultTableViewState(columns),
  );

  function renderBody() {
    if (loading && entries === null) {
      return (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner /> Loading history…
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
    if (rows.length === 0) {
      return (
        <EmptyState
          title="No reconciliations yet"
          description={
            canEdit
              ? "Reconcile this lot to record its first count."
              : "No reconciliations have been recorded for this lot."
          }
        />
      );
    }
    return (
      <DataTable
        columns={columns}
        data={rows}
        viewState={viewState}
        onViewStateChange={setViewState}
        mounted={mounted}
      />
    );
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Reconciliation history
        </h2>
        {canEdit ? (
          <Button size="sm" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Cancel" : "Reconcile…"}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <div className="mb-4 rounded-md border border-input p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">
            Reconcile against a physical count
          </h3>
          <ReconcileForm
            ammoId={ammoId}
            quantityOnRecord={quantityOnRecord}
            onDone={afterReconcile}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      ) : null}

      {renderBody()}
    </Card>
  );
}
