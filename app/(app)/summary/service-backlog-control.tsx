"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import type { BacklogRow } from "@/src/domain/service-intervals/backlog";
import type { BulkServiceItem } from "@/src/domain/service-intervals/events-service";
import { validateServicedOn } from "@/src/domain/service-intervals/validate-event";
import { firstMessage, messageForCode } from "@/src/domain/validation-messages";
import { todayIso } from "@/src/lib/dates";
import { markServicedBulkAction } from "./actions";

/**
 * The `/summary` bulk mark-serviced control (R16) — the surface this
 * requirement was missing entirely: `logServiceEventsBulk` existed and was
 * tested, but nothing in the app called it, so an owner with many due items
 * still had to visit each one. This closes that gap from the one place the
 * owner already sees the whole backlog (KD8's roll-up).
 *
 * R21 (advisory only): nothing here blocks, gates, or confirms — no
 * `ConfirmDialog`. Safe-by-default (no bulk write is undoable): every
 * checkbox starts UNCHECKED, "Select all" is an explicit opt-in click, and
 * the submit button stays disabled until at least one row is checked. The
 * checklist itself is what "shows the owner exactly what will be marked
 * before they commit" — every due row is visible, checked or not, and only
 * the checked ones are sent.
 *
 * Renders nothing when the backlog is empty — the roll-up text above
 * ("0 items due…") already says so; an empty control here would be noise.
 */

const DATE_CODES = [
  "emptyServicedOn",
  "invalidServicedOn",
  "servicedOnInFuture",
];

export interface ServiceBacklogControlProps {
  backlog: BacklogRow[];
}

function rowKey(row: BacklogRow): string {
  return `${row.parentType}::${row.parentId}::${row.ruleName}`;
}

export function ServiceBacklogControl({ backlog }: ServiceBacklogControlProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [servicedOn, setServicedOn] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();
  const notesId = useId();
  const selectAllId = useId();
  const rowIdPrefix = useId();

  const allKeys = useMemo(() => backlog.map(rowKey), [backlog]);
  const allSelected = allKeys.length > 0 && selected.size === allKeys.length;

  if (backlog.length === 0) return null;

  function toggleRow(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateServicedOn(servicedOn);
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      document.getElementById(dateId)?.focus();
      return;
    }
    const items: BulkServiceItem[] = backlog
      .filter((row) => selected.has(rowKey(row)))
      .map((row) => ({
        parentType: row.parentType,
        parentId: row.parentId,
        ruleName: row.ruleName,
      }));
    if (items.length === 0) return;

    startTransition(async () => {
      const result = await markServicedBulkAction(items, servicedOn, notes);
      if (result.ok) {
        toast({
          message: `Marked ${items.length} ${items.length === 1 ? "rule" : "rules"} serviced`,
        });
        setSelected(new Set());
        setNotes("");
        router.refresh();
      } else if (result.codes) {
        setCodes(result.codes);
        const nonDateCode = result.codes.find(
          (code) => !DATE_CODES.includes(code),
        );
        if (nonDateCode) {
          setServerError(messageForCode(nonDateCode));
        }
      } else {
        setServerError(result.error ?? "Could not mark service.");
      }
    });
  }

  return (
    <Card role="region" aria-label="Mark service due">
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        Mark serviced
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {serverError ? (
          <Callout tone="destructive">{serverError}</Callout>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <label
            htmlFor={selectAllId}
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <input
              id={selectAllId}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="size-4 rounded border-input accent-primary"
            />
            Select all
          </label>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {selected.size} selected
          </span>
        </div>

        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {backlog.map((row, index) => {
            const key = rowKey(row);
            const inputId = `${rowIdPrefix}-${index}`;
            return (
              <li key={key}>
                <label
                  htmlFor={inputId}
                  className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-foreground hover:bg-muted/50"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggleRow(key)}
                    className="size-4 rounded border-input accent-primary"
                    aria-label={`${row.itemName} — ${row.ruleName}`}
                  />
                  <span className="font-medium">{row.itemName}</span>
                  <span className="text-muted-foreground">
                    — {row.ruleName}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        <div>
          <Button
            type="submit"
            size="sm"
            disabled={pending || selected.size === 0}
          >
            {pending ? "Marking…" : "Mark serviced"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
