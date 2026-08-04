"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  ACTIONS_COLUMN_ID,
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { Data } from "@/components/ui/typography";
import { useTableViewState } from "@/hooks/use-table-view-state";
import {
  type ServiceEventUpdateInput,
  validateServiceEventUpdateInput,
} from "@/src/domain/service-intervals/validate-event";
import { firstMessage } from "@/src/domain/validation-messages";
import {
  deleteServiceEventAction,
  updateServiceEventAction,
} from "./service-actions";

/**
 * An item's service history (U8, R17) — every service event, newest first,
 * naming the rule it serviced — plus, for an actor who may write (KTD3), the
 * correction path this unit adds: edit an event's date/notes, or delete it
 * outright. Server-loaded and passed in as a prop (the detail page already
 * loads it alongside the resolved rules in one `Promise.all`, mirroring how
 * `photos`/`documents` are loaded rather than fetched client-side);
 * `onChange` (mirroring `RangeSessionHistory`'s convention) lets the parent
 * `router.refresh()` after an edit or delete so every rule's due state,
 * derived on read, reflects the correction on the very next render.
 *
 * `canWrite` defaults to `false` so a caller that hasn't wired it through yet
 * renders read-only rather than failing to compile — see this component's
 * report for which detail view currently passes it.
 *
 * R21 (advisory only): no `ConfirmDialog` here. Deleting a service event has
 * no undo, but this feature is advisory throughout, and every other
 * destructive-ish action already shipped on this exact surface
 * (`service-rules-panel.tsx`'s Suppress/Remove) is a direct one-click write
 * with an immediate toast, never a blocking confirmation — Delete here
 * matches that, with the `destructive` button variant standing in as the
 * "this can't be undone" cue instead of an interrupting dialog.
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
  /**
   * True when the actor may correct or delete an event here (KTD3): an
   * edit-grantee or the owner on a firearm; the owner only on an accessory —
   * the exact same split `logServiceEvent`'s `authorizeEventWrite` enforces
   * server-side, so this flag only ever hides a control the write would
   * reject anyway, never grants one.
   */
  canWrite?: boolean;
  /** Called after a successful edit or delete so the parent can
   * `router.refresh()` for fresh due state (mirrors `RangeSessionHistory`'s
   * `onChange` convention). */
  onChange?: () => void;
}

const DATE_CODES = [
  "emptyServicedOn",
  "invalidServicedOn",
  "servicedOnInFuture",
];

interface EditServiceEventFormProps {
  entry: ServiceHistoryEntry;
  onCancel: () => void;
  onSaved: () => void;
}

/**
 * The inline "Save changes" form behind an entry's "Edit" control. Only
 * `servicedOn` and `notes` are editable fields — there is no rule-name field
 * at all, matching `updateServiceEvent`'s contract (an event's rule and
 * parent are fixed for its whole life; see that function's doc in
 * `events-service.ts`). Field labels ("Date serviced" / "Notes") match
 * `log-service-form.tsx`'s exactly, so the correction form reads as the same
 * kind of control as the original log-service one.
 */
function EditServiceEventForm({
  entry,
  onCancel,
  onSaved,
}: EditServiceEventFormProps) {
  const [servicedOn, setServicedOn] = useState(entry.servicedOn);
  const [notes, setNotes] = useState(entry.notes);
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();
  const notesId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: ServiceEventUpdateInput = { servicedOn, notes };
    const found = validateServiceEventUpdateInput(input);
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      document.getElementById(dateId)?.focus();
      return;
    }
    startTransition(async () => {
      const result = await updateServiceEventAction(entry.id, input);
      if (result.ok) {
        onSaved();
      } else if (result.codes) {
        setCodes(result.codes);
      } else {
        setServerError(result.error ?? "Could not save changes.");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      aria-label={`Edit service — ${entry.ruleName}, ${entry.servicedOn}`}
      className="flex flex-col gap-3 rounded-md border border-input p-3"
      noValidate
    >
      {serverError ? <Callout tone="destructive">{serverError}</Callout> : null}
      <Field
        label="Date serviced"
        controlId={dateId}
        required
        error={firstMessage(codes, DATE_CODES)}
      >
        <Input
          id={dateId}
          type="date"
          value={servicedOn}
          onChange={(e) => setServicedOn(e.target.value)}
          aria-invalid={DATE_CODES.some((c) => codes.includes(c))}
        />
      </Field>
      <Field label="Notes" controlId={notesId}>
        <Textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ServiceHistory({
  entries,
  canWrite = false,
  onChange,
}: ServiceHistoryProps) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();

  function afterMutation(message: string) {
    setEditingId(null);
    toast({ message });
    onChange?.();
  }

  function remove(entry: ServiceHistoryEntry) {
    setDeletingId(entry.id);
    startDelete(async () => {
      const result = await deleteServiceEventAction(entry.id);
      setDeletingId(null);
      if (result.ok) {
        afterMutation(`${entry.ruleName} entry deleted`);
      } else {
        toast({
          message: result.error ?? "Could not delete.",
          tone: "destructive",
        });
      }
    });
  }

  // Not memoized: `useTableViewState` only ever reads its `defaults` argument
  // once, on first render, via an internal ref (see its own doc) — so a fresh
  // `columns` array each render costs nothing beyond this small, bounded
  // (per-item) history list and avoids depending on `remove`/`afterMutation`,
  // which close over state that changes every render anyway.
  function buildColumns(): ColumnDef<ServiceHistoryEntry>[] {
    const cols: ColumnDef<ServiceHistoryEntry>[] = [
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
    ];
    if (canWrite) {
      cols.push({
        id: ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const entry = row.original;
          const isDeleting = deletePending && deletingId === entry.id;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingId(entry.id)}
                aria-label={`Edit service — ${entry.ruleName}, ${entry.servicedOn}`}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => remove(entry)}
                disabled={isDeleting}
                aria-label={`Delete service — ${entry.ruleName}, ${entry.servicedOn}`}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          );
        },
      });
    }
    return cols;
  }

  const columns = buildColumns();

  const { viewState, setViewState, mounted } = useTableViewState(
    "service-history",
    createDefaultTableViewState(columns),
  );

  const editingEntry = canWrite
    ? (entries.find((entry) => entry.id === editingId) ?? null)
    : null;

  return (
    <Card role="region" aria-label="Service history">
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        Service history
      </h2>
      {editingEntry ? (
        <div className="mb-4">
          <EditServiceEventForm
            key={editingEntry.id}
            entry={editingEntry}
            onCancel={() => setEditingId(null)}
            onSaved={() =>
              afterMutation(`${editingEntry.ruleName} entry updated`)
            }
          />
        </div>
      ) : null}
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
