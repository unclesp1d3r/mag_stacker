"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  ACTIONS_COLUMN_ID,
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { useTableViewState } from "@/hooks/use-table-view-state";
import type { RangeSession } from "@/src/domain/range-sessions/service";
import {
  RangeSessionForm,
  type RangeSessionFormValues,
} from "./range-session-form";
import {
  deleteRangeSessionAction,
  listRangeSessionsAction,
} from "./session-actions";

interface RangeSessionHistoryProps {
  firearmId: string;
  firearmName: string;
  /** True when the actor owns or has edit rights on the firearm (KTD7). */
  canEdit: boolean;
  /** Optional: when omitted (e.g. embedded on the detail page) no Close button renders. */
  onClose?: () => void;
  /** Called after a log/edit/delete so the parent can refresh the round total. */
  onChange: () => void;
}

type FormState =
  | { open: false }
  | { open: true; initial?: RangeSessionFormValues };

export function RangeSessionHistory({
  firearmId,
  firearmName,
  canEdit,
  onClose,
  onChange,
}: RangeSessionHistoryProps) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<RangeSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ open: false });
  const [target, setTarget] = useState<RangeSession | null>(null);
  const [loading, startLoad] = useTransition();
  const [deleting, startDelete] = useTransition();

  const load = useCallback(() => {
    setError(null);
    startLoad(async () => {
      const result = await listRangeSessionsAction(firearmId);
      if (result.ok) {
        setSessions(result.data?.sessions ?? []);
      } else {
        setError(result.error ?? "Could not load sessions.");
        setSessions([]);
      }
    });
  }, [firearmId]);

  // Load on open and whenever the firearm changes.
  useEffect(() => {
    load();
  }, [load]);

  function afterMutation() {
    setForm({ open: false });
    load();
    onChange();
  }

  function confirmDelete() {
    const session = target;
    if (!session) return;
    startDelete(async () => {
      const result = await deleteRangeSessionAction(session.id);
      setTarget(null);
      if (result.ok) {
        toast({ message: "Session removed", tone: "neutral" });
        load();
        onChange();
      } else {
        toast({
          message: result.error ?? "Could not delete.",
          tone: "destructive",
        });
      }
    });
  }

  const list = sessions ?? [];
  const total = list.reduce((sum, s) => sum + s.roundsFired, 0);

  const columns = useMemo<ColumnDef<RangeSession>[]>(() => {
    const cols: ColumnDef<RangeSession>[] = [
      {
        accessorKey: "date",
        id: "date",
        header: "Date",
        meta: { label: "Date" },
        cell: ({ getValue }) => (
          <span className="tabular">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "roundsFired",
        id: "rounds",
        header: "Rounds",
        meta: { numeric: true, label: "Rounds" },
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
    ];
    if (canEdit) {
      cols.push({
        id: ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const session = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setForm({
                    open: true,
                    initial: {
                      id: session.id,
                      date: session.date,
                      roundsFired: String(session.roundsFired),
                      notes: session.notes,
                    },
                  })
                }
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setTarget(session)}
              >
                Delete
              </Button>
            </div>
          );
        },
      });
    }
    return cols;
  }, [canEdit]);

  // Shared across every firearm's widget (per-widget, not per-firearm) — the
  // caller renders one of these per firearm detail page, and view-state
  // persistence is keyed by tableId, not firearmId.
  const { viewState, setViewState, mounted } = useTableViewState(
    "range-session-history",
    createDefaultTableViewState(columns),
  );

  function renderBody() {
    if (loading && sessions === null) {
      return (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner /> Loading sessions…
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
          title="No sessions logged"
          description={
            canEdit
              ? "Log a range session to start tracking rounds fired."
              : "No range sessions have been logged for this firearm."
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
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Range sessions — {firearmName}
          </h2>
          <p className="text-xs text-muted-foreground tabular">
            {total} rounds fired over {list.length} session
            {list.length === 1 ? "" : "s"}
          </p>
        </div>
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>

      {canEdit && !form.open ? (
        <div className="mb-4">
          <Button size="sm" onClick={() => setForm({ open: true })}>
            Log session
          </Button>
        </div>
      ) : null}

      {form.open ? (
        <div className="mb-4 rounded-md border border-input p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">
            {form.initial ? "Edit session" : "New session"}
          </h3>
          <RangeSessionForm
            // Remount when the edit target changes so the form's initial-value
            // state resets instead of reusing the previous session's values.
            key={form.initial?.id ?? "new"}
            firearmId={firearmId}
            initial={form.initial}
            onDone={afterMutation}
            onCancel={() => setForm({ open: false })}
          />
        </div>
      ) : null}

      {renderBody()}

      <ConfirmDialog
        open={target !== null}
        title="Delete this range session?"
        description="The firearm's lifetime round total will decrease by this session's rounds. This can’t be undone."
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setTarget(null)}
      />
    </Card>
  );
}
