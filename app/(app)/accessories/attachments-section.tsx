"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import type { Permission } from "@/src/auth/visibility";
import {
  ATTACHMENT_TYPES,
  attachmentTypeLabel,
} from "@/src/domain/accessories/constants";
import { firstMessage } from "@/src/domain/validation-messages";
import {
  createAttachmentAction,
  deleteAttachmentAction,
  updateAttachmentAction,
} from "./actions";

/**
 * Attachments panel on the accessory detail view (#23 U7, R15/R17).
 *
 * Mirrors the service-rules panel's shape: a list plus an inline add/edit form
 * and a delete confirmation. Every control is reachable by role and accessible
 * name — no `data-testid` anywhere (R18).
 *
 * A viewer (`permission === "view"`) gets the list and NO mutating affordance.
 * That is presentation only; the real gate is in the domain layer, which
 * authorizes each write through the parent accessory.
 */

export interface AttachmentItem {
  id: string;
  type: string;
  spec: string;
  serialNumber: string;
  notes: string;
}

interface AttachmentsSectionProps {
  accessoryId: string;
  attachments: AttachmentItem[];
  permission: Permission;
  onChanged: () => void;
}

interface DraftValues {
  type: string;
  spec: string;
  serialNumber: string;
  notes: string;
}

const EMPTY_DRAFT: DraftValues = {
  type: "",
  spec: "",
  serialNumber: "",
  notes: "",
};

type EditorState =
  | { open: false }
  | { open: true; editingId: string | null; values: DraftValues };

export function AttachmentsSection({
  accessoryId,
  attachments,
  permission,
  onChanged,
}: AttachmentsSectionProps) {
  const { toast } = useToast();
  const canEdit = permission === "owner" || permission === "edit";
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<AttachmentItem | null>(
    null,
  );
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const typeId = useId();
  const specId = useId();
  const serialId = useId();
  const notesId = useId();

  function openCreate() {
    setCodes([]);
    setServerError(null);
    setEditor({ open: true, editingId: null, values: EMPTY_DRAFT });
  }

  function openEdit(item: AttachmentItem) {
    setCodes([]);
    setServerError(null);
    setEditor({
      open: true,
      editingId: item.id,
      values: {
        type: item.type,
        spec: item.spec,
        serialNumber: item.serialNumber,
        notes: item.notes,
      },
    });
  }

  function setValue<K extends keyof DraftValues>(
    key: K,
    value: DraftValues[K],
  ) {
    setEditor((state) =>
      state.open
        ? { ...state, values: { ...state.values, [key]: value } }
        : state,
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor.open) return;
    setServerError(null);

    const { editingId, values } = editor;
    startTransition(async () => {
      const result = editingId
        ? await updateAttachmentAction(editingId, accessoryId, values)
        : await createAttachmentAction(accessoryId, values);
      if (result.ok) {
        toast({
          message: editingId ? "Attachment updated" : "Attachment added",
          detail: attachmentTypeLabel(values.type),
        });
        setEditor({ open: false });
        onChanged();
      } else if (result.codes) {
        setCodes(result.codes);
        document.getElementById(typeId)?.focus();
      } else {
        setServerError(result.error ?? "Could not save.");
      }
    });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    startTransition(async () => {
      const result = await deleteAttachmentAction(target.id, accessoryId);
      setPendingDelete(null);
      if (result.ok) {
        toast({
          message: "Attachment removed",
          detail: attachmentTypeLabel(target.type),
        });
        onChanged();
      } else {
        setServerError(result.error ?? "Could not remove the attachment.");
      }
    });
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Attachments</h2>
          <p className="text-xs text-muted-foreground">
            Mounts, pistons, end caps and other hardware for this accessory.
          </p>
        </div>
        {canEdit && !editor.open ? (
          <Button type="button" variant="ghost" onClick={openCreate}>
            Add attachment
          </Button>
        ) : null}
      </div>

      {serverError ? (
        <div className="mb-4">
          <Callout tone="destructive">{serverError}</Callout>
        </div>
      ) : null}

      {editor.open ? (
        <form onSubmit={submit} className="mb-4 flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Attachment type"
              controlId={typeId}
              required
              error={firstMessage(codes, ["invalidAttachmentType"])}
            >
              <Select
                id={typeId}
                value={editor.values.type}
                onChange={(e) => setValue("type", e.target.value)}
                aria-invalid={codes.includes("invalidAttachmentType")}
              >
                <option value="">Select a type…</option>
                {ATTACHMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {attachmentTypeLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Spec"
              controlId={specId}
              hint="Optional — thread pitch or bore, e.g. 1/2x28"
            >
              <Input
                id={specId}
                value={editor.values.spec}
                onChange={(e) => setValue("spec", e.target.value)}
              />
            </Field>
          </div>

          <Field label="Serial number" controlId={serialId} hint="Optional">
            <Input
              id={serialId}
              value={editor.values.serialNumber}
              onChange={(e) => setValue("serialNumber", e.target.value)}
            />
          </Field>

          <Field label="Notes" controlId={notesId} hint="Optional">
            <Textarea
              id={notesId}
              value={editor.values.notes}
              onChange={(e) => setValue("notes", e.target.value)}
            />
          </Field>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending
                ? "Saving…"
                : editor.editingId
                  ? "Save attachment"
                  : "Add attachment"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditor({ open: false })}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {attachments.length === 0 ? (
        <EmptyState
          title="No attachments"
          description={
            canEdit
              ? "Record the mount, piston or end cap this accessory uses."
              : "Nothing has been recorded for this accessory."
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {attachments.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {attachmentTypeLabel(item.type)}
                  {item.spec ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {item.spec}
                    </span>
                  ) : null}
                </p>
                {item.serialNumber ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    {item.serialNumber}
                  </p>
                ) : null}
                {item.notes.trim() !== "" ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    {item.notes}
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => openEdit(item)}
                    aria-label={`Edit ${attachmentTypeLabel(item.type)} attachment`}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPendingDelete(item)}
                    aria-label={`Remove ${attachmentTypeLabel(item.type)} attachment`}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove attachment"
        description={
          pendingDelete
            ? `Remove the ${attachmentTypeLabel(pendingDelete.type)} attachment? This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        pending={pending}
      />
    </Card>
  );
}
