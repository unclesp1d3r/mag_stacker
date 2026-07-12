"use client";

import {
  BookOpen,
  File,
  FileText,
  type LucideIcon,
  Receipt,
  ShieldCheck,
  Umbrella,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_DOC_TYPE,
  DOC_TYPES,
  type DocType,
} from "@/src/domain/firearm-documents/constants";
import type { CreateDocumentErrorCode } from "@/src/domain/firearm-documents/service";
import {
  documentDownloadUrl,
  documentViewUrl,
} from "@/src/domain/firearm-documents/urls";
import { isDocType } from "@/src/domain/firearm-documents/validate";
import {
  deleteDocumentAction,
  uploadDocumentsAction,
} from "../documents-actions";

/**
 * Detail-view documents section (#12 U7). OWNER-ONLY — this component is
 * mounted only when `firearm-detail-view.tsx` resolves `isOwner`; every
 * mutation it calls (`uploadDocumentsAction`, `deleteDocumentAction`) is
 * itself owner-only authorized in the domain service (R8), so there is no
 * separate `canEdit` gate here the way `firearm-photos.tsx` has one.
 *
 * The narrow row shape this section needs (mirrors `FirearmPhotoRow`) rather
 * than importing the full `FirearmDocument` DB row type — `listDocuments`'s
 * return structurally satisfies this shape.
 */
export interface FirearmDocumentRow {
  id: string;
  filename: string;
  mimeType: string;
  docType: string;
  notes: string;
}

interface FirearmDocumentsProps {
  firearmId: string;
  /** Server-loaded via `listDocuments`, most-recently-uploaded first (R25) —
   * this component renders the given order as-is and never re-sorts locally. */
  documents: FirearmDocumentRow[];
}

interface UploadFailure {
  filename: string;
  message: string;
}

const DOC_TYPE_LABEL: Record<DocType, string> = {
  receipt: "Receipt",
  warranty: "Warranty",
  "atf-form-1": "ATF Form 1",
  "atf-form-4": "ATF Form 4",
  manual: "Manual",
  insurance: "Insurance",
  other: "Other",
};

const DOC_TYPE_ICON: Record<DocType, LucideIcon> = {
  receipt: Receipt,
  warranty: ShieldCheck,
  "atf-form-1": FileText,
  "atf-form-4": FileText,
  manual: BookOpen,
  insurance: Umbrella,
  other: File,
};

// `docType` arrives as a plain DB `text` value, so an unrecognized value (drift
// between the app's controlled set and a direct DB write) falls back gracefully
// instead of throwing. `isDocType` is the shared guard from the pure validator.
function docTypeLabel(value: string): string {
  return isDocType(value) ? DOC_TYPE_LABEL[value] : value;
}

function docTypeIcon(value: string): LucideIcon {
  return isDocType(value) ? DOC_TYPE_ICON[value] : File;
}

/** Per-file/batch failure codes → human-readable reasons (mirrors
 * `firearm-photos.tsx`'s `UPLOAD_FAILURE_MESSAGES`). */
const UPLOAD_FAILURE_MESSAGES: Record<CreateDocumentErrorCode, string> = {
  disallowedMimeType:
    "unsupported file type (PDF, JPEG, PNG, WEBP, or AVIF only)",
  fileTooLarge: "file exceeds the 25 MB size limit",
  contentMismatch: "file content doesn't match an allowed type",
  uploadFailed: "could not save this file, please try again",
  tooManyFiles: "too many files in one upload (10 max)",
  documentQuotaExceeded:
    "this firearm already has the maximum number of documents",
};

function uploadFailureMessage(code: string): string {
  return (
    UPLOAD_FAILURE_MESSAGES[code as keyof typeof UPLOAD_FAILURE_MESSAGES] ??
    "could not upload this file"
  );
}

const ACCEPTED_MIME_TYPES =
  "application/pdf,image/jpeg,image/png,image/webp,image/avif";

/** Mirrors sharp-derived thumbnails' fixed-size treatment in
 * `firearm-photos.tsx`, but for the View modal's media box — capped so a huge
 * scanned document never blows out the modal (R14/R21). */
const VIEW_MEDIA_MAX_HEIGHT = "70vh";

/**
 * The iframe `sandbox` token set for rendering an untrusted PDF inline (R15).
 * CRITICAL: `allow-scripts` and `allow-same-origin` must NEVER both be present
 * — combined, they let framed script reach back into this origin (cookies,
 * DOM, same-origin fetches), defeating the sandbox entirely. `allow-scripts`
 * alone keeps the frame's script execution confined to a unique opaque
 * origin (no access to this app's cookies/storage) while still letting the
 * browser's built-in PDF viewer (which runs its own UI script inside the
 * frame) render and paginate the document.
 */
const PDF_SANDBOX = "allow-scripts";

/**
 * `Button` (`components/ui/button.tsx`) renders a plain `<button>` with no
 * `asChild`/Slot support, so the Download control — which must be a real
 * anchor carrying `download` (R13) rather than a click handler — is a
 * hand-styled `<a>` matching `Button`'s `secondary`/`sm` and `primary`/`sm`
 * visual treatment (`VARIANTS`/`SIZES` in that file) rather than the shared
 * component itself.
 */
const DOWNLOAD_LINK_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground transition-[filter,background-color,color,transform] duration-150 hover:bg-muted active:translate-y-px";
const DOWNLOAD_PRIMARY_LINK_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-primary px-3 text-sm font-medium text-primary-foreground shadow-[var(--glow-primary)] transition-[filter,background-color,color,transform] duration-150 hover:brightness-105 active:translate-y-px active:brightness-95";

export function FirearmDocuments({
  firearmId,
  documents,
}: FirearmDocumentsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const uploadInputId = useId();
  const docTypeSelectId = useId();
  const notesId = useId();
  const viewTitleId = useId();

  const [uploading, startUpload] = useTransition();
  const [deleting, startDelete] = useTransition();

  const [pendingCount, setPendingCount] = useState(0);
  const [failures, setFailures] = useState<UploadFailure[]>([]);
  const [docType, setDocType] = useState<DocType>(DEFAULT_DOC_TYPE);
  const [notes, setNotes] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<FirearmDocumentRow | null>(
    null,
  );
  const [viewTarget, setViewTarget] = useState<FirearmDocumentRow | null>(null);
  const [viewLoadFailed, setViewLoadFailed] = useState(false);

  const viewPanelRef = useRef<HTMLDivElement>(null);
  const viewCloseRef = useRef<HTMLButtonElement>(null);
  const viewRestoreFocusRef = useRef<HTMLElement | null>(null);

  // Initial focus on the close control; restore focus to the trigger on close;
  // Escape dismisses (handler below). This is lighter than `ConfirmDialog` — it
  // does not Tab-trap focus within the modal — which is acceptable here because
  // the modal's only interactive controls are Close and (on error) Download.
  useEffect(() => {
    if (!viewTarget) return;
    viewRestoreFocusRef.current = document.activeElement as HTMLElement | null;
    viewCloseRef.current?.focus();
    return () => viewRestoreFocusRef.current?.focus?.();
  }, [viewTarget]);

  useEffect(() => {
    if (!viewTarget) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewTarget(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewTarget]);

  function openView(doc: FirearmDocumentRow) {
    setViewLoadFailed(false);
    setViewTarget(doc);
  }

  function closeView() {
    setViewTarget(null);
    setViewLoadFailed(false);
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    // Capture synchronously — `event.currentTarget` nulls out once the
    // handler returns, so it must not be read after an `await`.
    const input = event.currentTarget;
    const selected = Array.from(input.files ?? []);
    input.value = ""; // allow re-selecting the same file(s) later
    if (selected.length === 0) return;

    setFailures([]);
    setPendingCount(selected.length);

    startUpload(async () => {
      const formData = new FormData();
      for (const file of selected) formData.append("files", file);
      formData.set("docType", docType);
      formData.set("notes", notes);

      const result = await uploadDocumentsAction(firearmId, formData);

      if (!result.ok) {
        const message =
          result.codes && result.codes.length > 0
            ? result.codes.map(uploadFailureMessage).join("; ")
            : (result.error ?? "Upload failed.");
        toast({ message, tone: "destructive" });
        return;
      }

      const newFailures: UploadFailure[] = [];
      let succeeded = 0;
      const results = result.data?.results ?? [];
      for (const [i, fileResult] of results.entries()) {
        if (fileResult.ok) {
          succeeded += 1;
        } else {
          newFailures.push({
            filename: selected[i]?.name ?? `file ${i + 1}`,
            message: fileResult.codes.map(uploadFailureMessage).join("; "),
          });
        }
      }
      setFailures(newFailures);

      if (succeeded > 0) {
        toast({
          message: `${succeeded} document${succeeded === 1 ? "" : "s"} uploaded`,
          tone: "ok",
        });
        setNotes("");
      }
      if (newFailures.length > 0 && succeeded === 0) {
        toast({
          message: `${newFailures.length} file${newFailures.length === 1 ? "" : "s"} could not be uploaded`,
          tone: "destructive",
        });
      }

      router.refresh();
    });
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    startDelete(async () => {
      const result = await deleteDocumentAction(target.id);
      setDeleteTarget(null);
      if (!result.ok) {
        toast({
          message: result.error ?? "Could not delete document.",
          tone: "destructive",
        });
        return;
      }
      if (viewTarget?.id === target.id) closeView();
      toast({ message: "Document deleted", tone: "neutral" });
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Documents</h2>
          <p className="text-xs text-muted-foreground tabular">
            {documents.length} document{documents.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="mb-5 rounded-md border border-input p-4">
        <Field
          label="Upload documents"
          controlId={uploadInputId}
          hint="PDF, JPEG, PNG, WEBP, or AVIF — up to 25 MB per file, 10 files per upload."
        >
          <input
            id={uploadInputId}
            name="files"
            type="file"
            multiple
            accept={ACCEPTED_MIME_TYPES}
            disabled={uploading}
            onChange={handleFilesSelected}
            className="block w-full text-sm text-foreground file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-sm file:font-medium file:text-primary-foreground file:transition-[filter] hover:file:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
          />
        </Field>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Document type" controlId={docTypeSelectId}>
            <Select
              id={docTypeSelectId}
              value={docType}
              disabled={uploading}
              onChange={(event) => setDocType(event.target.value as DocType)}
            >
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOC_TYPE_LABEL[type]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)" controlId={notesId}>
            <Textarea
              id={notesId}
              value={notes}
              disabled={uploading}
              onChange={(event) => setNotes(event.target.value)}
              rows={1}
              className="text-sm"
            />
          </Field>
        </div>

        {/* Always present so assistive tech gets the pending announcement
         * without a landmark appearing/disappearing (mirrors firearm-photos.tsx). */}
        <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          {uploading
            ? `Uploading ${pendingCount} document${pendingCount === 1 ? "" : "s"}…`
            : ""}
        </p>
        {failures.length > 0 ? (
          <div className="mt-3">
            <Callout tone="destructive">
              <p className="mb-1 font-medium">
                {failures.length} file{failures.length === 1 ? "" : "s"} not
                uploaded:
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {failures.map((f) => (
                  <li key={f.filename}>
                    {f.filename}: {f.message}
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        ) : null}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Upload a receipt, warranty, ATF form, manual, or other document above."
        />
      ) : (
        <ul aria-label="Document list" className="flex flex-col gap-2">
          {documents.map((doc) => {
            const label = docTypeLabel(doc.docType);
            const Icon = docTypeIcon(doc.docType);
            return (
              <li
                key={doc.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted">
                  <Icon aria-hidden="true" className="size-4 text-ink-soft" />
                  <span className="sr-only">{label} document</span>
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {doc.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  {doc.notes ? (
                    <p className="mt-0.5 wrap-break-word text-xs text-ink-soft">
                      {doc.notes}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`View ${label} — ${doc.filename}`}
                    onClick={() => openView(doc)}
                  >
                    View
                  </Button>
                  <a
                    href={documentDownloadUrl(doc.id)}
                    download={doc.filename}
                    aria-label={`Download ${label} — ${doc.filename}`}
                    className={DOWNLOAD_LINK_CLASS}
                  >
                    Download
                  </a>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleting}
                    aria-label={`Delete ${label} — ${doc.filename}`}
                    onClick={() => setDeleteTarget(doc)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {viewTarget ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal is a convenience; Escape and the Close button are the primary paths.
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-foreground/30 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeView();
          }}
        >
          <div
            ref={viewPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={viewTitleId}
            className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-pop)]"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id={viewTitleId}
                className="min-w-0 wrap-break-word text-pretty text-base font-semibold text-foreground"
              >
                {docTypeLabel(viewTarget.docType)} — {viewTarget.filename}
              </h2>
              <Button
                ref={viewCloseRef}
                variant="ghost"
                size="sm"
                aria-label="Close document view"
                onClick={closeView}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-auto">
              {viewLoadFailed ? (
                <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-input bg-muted/50 p-10 text-center">
                  <p className="text-sm text-ink-soft">
                    This document could not be displayed.
                  </p>
                  <a
                    href={documentDownloadUrl(viewTarget.id)}
                    download={viewTarget.filename}
                    className={DOWNLOAD_PRIMARY_LINK_CLASS}
                  >
                    Download instead
                  </a>
                </div>
              ) : viewTarget.mimeType.startsWith("image/") ? (
                <img
                  src={documentViewUrl(viewTarget.id)}
                  alt={`${docTypeLabel(viewTarget.docType)} — ${viewTarget.filename}`}
                  style={{ maxHeight: VIEW_MEDIA_MAX_HEIGHT }}
                  className="mx-auto max-w-full rounded-md object-contain"
                  onError={() => setViewLoadFailed(true)}
                />
              ) : (
                <iframe
                  title={`${docTypeLabel(viewTarget.docType)} — ${viewTarget.filename}`}
                  src={documentViewUrl(viewTarget.id)}
                  sandbox={PDF_SANDBOX}
                  style={{ height: VIEW_MEDIA_MAX_HEIGHT }}
                  className="w-full rounded-md border border-border"
                  onError={() => setViewLoadFailed(true)}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={
          deleteTarget
            ? `Delete “${docTypeLabel(deleteTarget.docType)} — ${deleteTarget.filename}”?`
            : ""
        }
        description="This can’t be undone."
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}
