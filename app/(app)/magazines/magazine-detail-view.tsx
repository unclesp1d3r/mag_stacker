"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import type { Permission } from "@/src/auth/visibility";
import { deleteMagazineAction } from "./actions";
import {
  type FirearmOption,
  MagazineForm,
  type MagazineFormValues,
} from "./magazine-form";

export interface MagazineDetail extends MagazineFormValues {
  id: string;
  ownerId: string;
  /** Visible compatible firearms as {id, name} pairs — only those the viewer can
   * see (names of firearms not shared with a grantee are omitted, not leaked). */
  compatibleFirearms: { id: string; name: string }[];
}

interface MagazineDetailViewProps {
  magazine: MagazineDetail;
  permission: Permission;
  currentUserId: string;
  firearmOptions: FirearmOption[];
  caliberSuggestions: string[];
  prefixOptions: string[];
  prefixNextStart: Record<string, number>;
  magpulMode: boolean;
}

/** One read-only label/value row. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

function orDash(value: string): ReactNode {
  return value.trim() !== "" ? (
    value
  ) : (
    <span className="text-ink-faint">—</span>
  );
}

export function MagazineDetailView({
  magazine,
  permission,
  currentUserId,
  firearmOptions,
  caliberSuggestions,
  prefixOptions,
  prefixNextStart,
  magpulMode,
}: MagazineDetailViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Magazine actions are owner-only (R13) — edit-grantees get a read-only page.
  const isOwner = magazine.ownerId === currentUserId;
  const del = useDeleteConfirmation<MagazineDetail>({
    entityLabel: "Magazine",
    getName: (item) => item.brandModel,
    remove: deleteMagazineAction,
    redirectTo: "/magazines",
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const effectiveCapacity =
    Number(magazine.baseCapacity) + Number(magazine.extensionRounds);

  return (
    <div className="space-y-6">
      <Link
        href="/magazines"
        className="inline-block text-sm font-medium text-blaze hover:underline"
      >
        ← Magazines
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div className="space-y-1">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-pretty text-[1.75rem] font-bold leading-none tracking-[-0.02em] text-ink outline-none"
          >
            {magazine.brandModel}
          </h1>
          {!isOwner ? (
            <p className="text-sm text-ink-soft">
              <Badge tone="blaze">Shared with you · {permission}</Badge>
            </p>
          ) : null}
        </div>
        {isOwner ? (
          <div className="flex items-center gap-2">
            <ShareControl
              parentType="magazine"
              parentId={magazine.id}
              itemName={magazine.brandModel}
            />
            {!editing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            ) : null}
            <Button
              variant="danger"
              size="sm"
              onClick={() => del.request(magazine)}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </header>

      {editing ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-ink">Edit magazine</h2>
          <MagazineForm
            initial={magazine}
            firearmOptions={firearmOptions}
            caliberSuggestions={caliberSuggestions}
            prefixOptions={prefixOptions}
            prefixNextStart={prefixNextStart}
            magpulMode={magpulMode}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        </Card>
      ) : (
        <Card>
          <dl>
            <DetailRow label="Caliber" value={magazine.caliber} />
            <DetailRow
              label="Effective capacity"
              value={<span className="tabular">{effectiveCapacity}</span>}
            />
            <DetailRow
              label="Base capacity"
              value={<span className="tabular">{magazine.baseCapacity}</span>}
            />
            <DetailRow
              label="Extension rounds"
              value={
                <span className="tabular">{magazine.extensionRounds}</span>
              }
            />
            <DetailRow
              label="Label"
              value={
                <span className="font-mono text-xs">
                  {orDash(magazine.label)}
                </span>
              }
            />
            <DetailRow
              label="Acquired date"
              value={orDash(magazine.acquiredDate)}
            />
            <DetailRow
              label="Compatible firearms"
              value={
                magazine.compatibleFirearms.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {magazine.compatibleFirearms.map((f) => (
                      <Badge key={f.id} tone="neutral">
                        {f.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  orDash("")
                )
              }
            />
            <DetailRow
              label="Notes"
              value={
                magazine.notes.trim() !== "" ? (
                  <span className="whitespace-pre-wrap">{magazine.notes}</span>
                ) : (
                  orDash("")
                )
              }
            />
          </dl>
        </Card>
      )}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${magazine.brandModel}”?`}
        description="This removes the magazine from your inventory and can’t be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
