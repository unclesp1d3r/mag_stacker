"use client";

import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import {
  PREVIEW_MAX_EDGE,
  THUMB_MAX_EDGE,
} from "@/src/domain/firearm-photos/constants";
import type { CreatePhotoFailureCode } from "@/src/domain/firearm-photos/service";
import {
  deletePhotoAction,
  reorderPhotosAction,
  setPrimaryPhotoAction,
  updatePhotoCaptionAction,
  uploadPhotosAction,
} from "../photo-actions";

/**
 * Detail-view photo gallery + upload surface (#9 U7, R15, R17, R21-R25).
 *
 * The subset of a `firearm_photo` row this section needs to render — kept
 * narrow (mirrors `MountedAccessoryRow`) rather than importing the full
 * `FirearmPhoto` DB row type, since `listPhotos`'s return structurally
 * satisfies this shape and no reshaping is needed at the call site.
 */
export interface FirearmPhotoRow {
  id: string;
  caption: string;
  isPrimary: boolean;
  width: number;
  height: number;
}

interface FirearmPhotosProps {
  firearmId: string;
  /** Used only for the accessible-name fallback (R24) — never for authz. */
  firearmName: string;
  /** Server-loaded, already ordered by `sortOrder` ascending — this
   * component never clones it into local state (reactCompiler-safe): every
   * mutation calls `router.refresh()` so the parent Server Component
   * re-fetches `listPhotos` and passes a fresh array back down. */
  photos: FirearmPhotoRow[];
  /** True when the actor owns or has edit rights on the firearm (R14). Read
   * access (the gallery itself) does not depend on this — only the
   * mutation affordances (upload/primary/reorder/caption/delete) do. */
  canEdit: boolean;
}

interface UploadFailure {
  filename: string;
  message: string;
}

/** Per-file/batch failure codes → human-readable reasons (R21). Kept local
 * rather than added to `src/domain/validation-messages.ts` since that file
 * is a domain module this unit doesn't touch. */
const UPLOAD_FAILURE_MESSAGES: Record<
  CreatePhotoFailureCode | "tooManyFiles" | "photoQuotaExceeded",
  string
> = {
  disallowedMimeType: "unsupported file type (JPEG, PNG, WEBP, or AVIF only)",
  fileTooLarge: "file exceeds the 15 MB size limit",
  processingFailed: "could not process this image",
  tooManyFiles: "too many files in one upload (10 max)",
  photoQuotaExceeded: "this firearm already has the maximum number of photos",
};

function uploadFailureMessage(code: string): string {
  return (
    UPLOAD_FAILURE_MESSAGES[code as keyof typeof UPLOAD_FAILURE_MESSAGES] ??
    "could not upload this file"
  );
}

function photoUrl(photoId: string, variant: "thumb" | "preview"): string {
  return `/api/photos/${photoId}/${variant}`;
}

/** Mirrors sharp's `fit: "inside", withoutEnlargement: true` (`pipeline.ts`)
 * so the reserved `<img>` box matches the derivative's real pixel size
 * exactly — the box never changes size once the image loads (R17). */
function containDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / width, maxEdge / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Caption serves as the accessible name; an uncaptioned photo falls back to
 * the firearm name plus its 1-indexed gallery position (R24). */
function photoAccessibleName(
  photo: FirearmPhotoRow,
  position: number,
  firearmName: string,
): string {
  return photo.caption.trim() !== ""
    ? photo.caption
    : `${firearmName} — photo ${position}`;
}

export function FirearmPhotos({
  firearmId,
  firearmName,
  photos,
  canEdit,
}: FirearmPhotosProps) {
  const router = useRouter();
  const { toast } = useToast();
  const uploadInputId = useId();

  const [uploading, startUpload] = useTransition();
  const [mutating, startMutate] = useTransition();
  const [deleting, startDelete] = useTransition();

  const [pendingCount, setPendingCount] = useState(0);
  const [failures, setFailures] = useState<UploadFailure[]>([]);

  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<FirearmPhotoRow | null>(
    null,
  );

  const primaryIndex = photos.findIndex((p) => p.isPrimary);
  const primary = primaryIndex >= 0 ? photos[primaryIndex] : null;

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

      const result = await uploadPhotosAction(firearmId, formData);

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
          message: `${succeeded} photo${succeeded === 1 ? "" : "s"} uploaded`,
          tone: "ok",
        });
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

  function handleSetPrimary(photoId: string) {
    startMutate(async () => {
      const result = await setPrimaryPhotoAction(photoId);
      if (!result.ok) {
        toast({
          message: result.error ?? "Could not set primary photo.",
          tone: "destructive",
        });
        return;
      }
      router.refresh();
    });
  }

  function handleMove(photoId: string, direction: "up" | "down") {
    const index = photos.findIndex((p) => p.id === photoId);
    if (index === -1) return;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= photos.length) return;

    // Build the new order on a fresh copy — `photos` (the prop) is never
    // mutated in place.
    const reordered = [...photos];
    const moved = reordered[index];
    const other = reordered[swapWith];
    if (!moved || !other) return;
    reordered[index] = other;
    reordered[swapWith] = moved;
    const orderedIds = reordered.map((p) => p.id);

    startMutate(async () => {
      const result = await reorderPhotosAction(firearmId, orderedIds);
      if (!result.ok) {
        toast({
          message: result.error ?? "Could not reorder photos.",
          tone: "destructive",
        });
        return;
      }
      router.refresh();
    });
  }

  function startCaptionEdit(photo: FirearmPhotoRow) {
    setEditingCaptionId(photo.id);
    setCaptionDraft(photo.caption);
  }

  function cancelCaptionEdit() {
    setEditingCaptionId(null);
    setCaptionDraft("");
  }

  function saveCaption(photoId: string) {
    const value = captionDraft.trim();
    startMutate(async () => {
      const result = await updatePhotoCaptionAction(photoId, value);
      if (!result.ok) {
        toast({
          message: result.error ?? "Could not save caption.",
          tone: "destructive",
        });
        return;
      }
      setEditingCaptionId(null);
      setCaptionDraft("");
      router.refresh();
    });
  }

  function handleRemoveCaption(photoId: string) {
    startMutate(async () => {
      const result = await updatePhotoCaptionAction(photoId, "");
      if (!result.ok) {
        toast({
          message: result.error ?? "Could not remove caption.",
          tone: "destructive",
        });
        return;
      }
      router.refresh();
    });
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    startDelete(async () => {
      const result = await deletePhotoAction(target.id);
      setDeleteTarget(null);
      if (!result.ok) {
        toast({
          message: result.error ?? "Could not delete photo.",
          tone: "destructive",
        });
        return;
      }
      toast({ message: "Photo deleted", tone: "neutral" });
      router.refresh();
    });
  }

  const primaryDims = primary
    ? containDimensions(primary.width, primary.height, PREVIEW_MAX_EDGE)
    : null;
  const rowBusy = mutating || deleting;

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Photos</h2>
          <p className="text-xs text-muted-foreground tabular">
            {photos.length} photo{photos.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {canEdit ? (
        <div className="mb-5 rounded-md border border-input p-4">
          <Field
            label="Upload photos"
            controlId={uploadInputId}
            hint="JPEG, PNG, WEBP, or AVIF — up to 15 MB per file, 10 files per upload."
          >
            <input
              id={uploadInputId}
              name="files"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={uploading}
              onChange={handleFilesSelected}
              className="block w-full text-sm text-foreground file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-sm file:font-medium file:text-primary-foreground file:transition-[filter] hover:file:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
            />
          </Field>
          {/* Always present so assistive tech gets the pending announcement
           * without a landmark appearing/disappearing (R25). */}
          <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
            {uploading
              ? `Uploading ${pendingCount} photo${pendingCount === 1 ? "" : "s"}…`
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
      ) : null}

      <div className="mb-5">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Primary photo
        </h3>
        {primary && primaryDims ? (
          <figure className="w-fit">
            <img
              src={photoUrl(primary.id, "preview")}
              alt={photoAccessibleName(primary, primaryIndex + 1, firearmName)}
              width={primaryDims.width}
              height={primaryDims.height}
              loading="eager"
              className="max-h-80 max-w-full rounded-md border border-border bg-muted object-contain"
            />
            {primary.caption.trim() !== "" ? (
              <figcaption className="mt-1.5 text-xs text-ink-soft">
                {primary.caption}
              </figcaption>
            ) : null}
          </figure>
        ) : (
          // Fixed-size neutral placeholder (R22): no photos (or no primary)
          // renders this instead of a broken image or a reflow.
          <div className="flex h-48 w-64 max-w-full items-center justify-center rounded-md border border-dashed border-input bg-muted/50 text-sm text-muted-foreground">
            No photos yet
          </div>
        )}
      </div>

      <ul
        aria-label="Photo gallery"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      >
        {photos.map((photo, index) => {
          const position = index + 1;
          const dims = containDimensions(
            photo.width,
            photo.height,
            THUMB_MAX_EDGE,
          );
          const name = photoAccessibleName(photo, position, firearmName);
          const editingThis = editingCaptionId === photo.id;
          const hasCaption = photo.caption.trim() !== "";

          return (
            <li
              key={photo.id}
              className="flex flex-col gap-1.5 rounded-md border border-border p-2"
            >
              <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-sm bg-muted">
                <img
                  src={photoUrl(photo.id, "thumb")}
                  alt={name}
                  width={dims.width}
                  height={dims.height}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
                {photo.isPrimary ? (
                  <span className="absolute left-1 top-1">
                    <Badge tone="primary">Primary</Badge>
                  </span>
                ) : null}
              </div>

              {editingThis ? (
                <div className="flex flex-col gap-1.5">
                  <Textarea
                    aria-label={`Caption for photo ${position}`}
                    value={captionDraft}
                    onChange={(event) => setCaptionDraft(event.target.value)}
                    rows={2}
                    className="text-xs"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={mutating}
                      onClick={() => saveCaption(photo.id)}
                    >
                      Save caption
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={mutating}
                      onClick={cancelCaptionEdit}
                    >
                      Cancel caption edit
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="min-h-8 text-xs text-ink-soft">
                  {hasCaption ? (
                    photo.caption
                  ) : (
                    <span className="text-muted-foreground">No caption</span>
                  )}
                </p>
              )}

              {canEdit && !editingThis ? (
                <div className="mt-auto flex flex-wrap gap-1">
                  {!photo.isPrimary ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={rowBusy}
                      aria-label={`Set photo ${position} as primary`}
                      onClick={() => handleSetPrimary(photo.id)}
                    >
                      Set primary
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rowBusy || index === 0}
                    aria-label={`Move photo ${position} up`}
                    onClick={() => handleMove(photo.id, "up")}
                  >
                    <span aria-hidden="true">↑</span> Up
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rowBusy || index === photos.length - 1}
                    aria-label={`Move photo ${position} down`}
                    onClick={() => handleMove(photo.id, "down")}
                  >
                    <span aria-hidden="true">↓</span> Down
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rowBusy}
                    aria-label={
                      hasCaption
                        ? `Edit caption for photo ${position}`
                        : `Add caption for photo ${position}`
                    }
                    onClick={() => startCaptionEdit(photo)}
                  >
                    {hasCaption ? "Edit caption" : "Add caption"}
                  </Button>
                  {hasCaption ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rowBusy}
                      aria-label={`Remove caption from photo ${position}`}
                      onClick={() => handleRemoveCaption(photo.id)}
                    >
                      Remove caption
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={rowBusy}
                    aria-label={`Delete photo ${position}`}
                    onClick={() => setDeleteTarget(photo)}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this photo?"
        description="This can’t be undone."
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}
