"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
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
  onClose: () => void;
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

  function load() {
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
  }

  // Load on open and whenever the firearm changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load is stable for a fixed firearmId
  useEffect(() => {
    load();
  }, [firearmId]);

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
        toast({ message: result.error ?? "Could not delete.", tone: "danger" });
      }
    });
  }

  const total = (sessions ?? []).reduce((sum, s) => sum + s.roundsFired, 0);

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Range sessions — {firearmName}
          </h2>
          <p className="text-xs text-ink-faint tabular">
            {total} rounds fired over {(sessions ?? []).length} session
            {(sessions ?? []).length === 1 ? "" : "s"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {canEdit && !form.open ? (
        <div className="mb-4">
          <Button size="sm" onClick={() => setForm({ open: true })}>
            Log session
          </Button>
        </div>
      ) : null}

      {form.open ? (
        <div className="mb-4 rounded-[var(--radius)] border border-line-strong p-4">
          <h3 className="mb-3 text-sm font-medium text-ink">
            {form.initial ? "Edit session" : "New session"}
          </h3>
          <RangeSessionForm
            firearmId={firearmId}
            initial={form.initial}
            onDone={afterMutation}
            onCancel={() => setForm({ open: false })}
          />
        </div>
      ) : null}

      {loading && sessions === null ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner /> Loading sessions…
        </p>
      ) : error ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="ghost" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : sessions && sessions.length === 0 ? (
        <EmptyState
          title="No sessions logged"
          description={
            canEdit
              ? "Log a range session to start tracking rounds fired."
              : "No range sessions have been logged for this firearm."
          }
        />
      ) : (
        <DataTable>
          <THead>
            <TH>Date</TH>
            <TH className="text-right">Rounds</TH>
            <TH>Notes</TH>
            {canEdit ? <TH className="text-right">Actions</TH> : null}
          </THead>
          <tbody>
            {(sessions ?? []).map((session) => (
              <TRow key={session.id}>
                <TD className="tabular">{session.date}</TD>
                <TD className="text-right tabular">{session.roundsFired}</TD>
                <TD className="text-ink-soft">{session.notes}</TD>
                {canEdit ? (
                  <TD className="text-right">
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
                        variant="danger"
                        size="sm"
                        onClick={() => setTarget(session)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                ) : null}
              </TRow>
            ))}
          </tbody>
        </DataTable>
      )}

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
