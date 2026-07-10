"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  DataTableSkeleton,
} from "@/components/ui/data-table/data-table";
import { GroupedTableView } from "@/components/ui/data-table/grouped-table-view";
import {
  ACTIONS_COLUMN_ID,
  type ColumnDef,
  createDefaultTableViewState,
  type TableViewState,
} from "@/components/ui/data-table/types";
import { EmptyState } from "@/components/ui/feedback";
import {
  PhotoThumbnail,
  type ThumbnailPhoto,
} from "@/components/ui/photo-thumbnail";
import { Select } from "@/components/ui/select";
import { Card, PageHeader } from "@/components/ui/surface";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import { useRowFlash } from "@/hooks/use-row-flash";
import { useTableViewState } from "@/hooks/use-table-view-state";
import {
  FIREARM_TYPES,
  firearmActionLabel,
  firearmTypeLabel,
} from "@/src/domain/firearms/constants";
import { firearmDisplayName, hasNickname } from "@/src/domain/firearms/display";
import { firearmByTypeKey } from "@/src/domain/tables/firearm-groups";
import { deleteFirearmAction } from "./actions";
import { FirearmForm, type FirearmFormValues } from "./firearm-form";

/** Filter sentinel: show every type. */
const ALL_TYPES = "all";

export interface FirearmListItem extends FirearmFormValues {
  id: string;
  ownerId: string;
  magazineCount: number;
  /** Derived lifetime rounds fired across this firearm's sessions (#11). */
  roundTotal: number;
  /** This firearm's primary photo, batch-resolved by the page loader via
   * `primaryThumbnailsFor` (R18) — `null` when it has none (R22). */
  primaryPhoto: ThumbnailPhoto | null;
}

interface FirearmsViewProps {
  firearms: FirearmListItem[];
  currentUserId: string;
  showSerial: boolean;
  caliberSuggestions: string[];
  manufacturerSuggestions: string[];
  subtypeSuggestions: string[];
}

type FormState = { open: false } | { open: true };

type GroupingMode = "none" | "type";

interface FirearmFilters {
  type: string;
}

interface FirearmViewState extends TableViewState {
  grouping: GroupingMode;
  filters: FirearmFilters;
}

export function FirearmsView({
  firearms,
  currentUserId,
  showSerial,
  caliberSuggestions,
  manufacturerSuggestions,
  subtypeSuggestions,
}: FirearmsViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ open: false });
  const { flashId, flash } = useRowFlash();
  const filterId = useId();
  const groupingId = useId();

  const del = useDeleteConfirmation<FirearmListItem>({
    entityLabel: "Firearm",
    getName: (item) => firearmDisplayName(item),
    remove: deleteFirearmAction,
  });
  // Stable `useState` setter — depend column defs on it, not the fresh-per-render
  // `del` object, so `columns` doesn't rebuild on dialog open/close and remount
  // the actions cell (which would drop focus restore and ShareControl state).
  const requestDelete = del.request;

  // Same-named firearms get a non-sensitive id-fragment suffix on the row
  // link's accessible name so a screen-reader link list stays unambiguous
  // (R17/R52). The fragment (not a visible column value) avoids colliding
  // with other cells.
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of firearms) {
      const n = firearmDisplayName(f);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return counts;
  }, [firearms]);
  // Ref-read keeps `linkLabel` (and thus `columns`) stable across data
  // refetches, so a list refresh (e.g. after a ShareControl grant) doesn't
  // rebuild columns and remount the actions cell mid-dialog.
  const nameCountsRef = useRef(nameCounts);
  nameCountsRef.current = nameCounts;
  const linkLabel = useCallback((item: FirearmListItem): string | undefined => {
    const name = firearmDisplayName(item);
    return (nameCountsRef.current.get(name) ?? 0) > 1
      ? `${name} (#${item.id.slice(0, 6)})`
      : undefined;
  }, []);

  const columns = useMemo<ColumnDef<FirearmListItem>[]>(() => {
    const cols: ColumnDef<FirearmListItem>[] = [
      {
        id: "photo",
        header: () => <span className="sr-only">Photo</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <PhotoThumbnail
            photo={row.original.primaryPhoto}
            alt={firearmDisplayName(row.original)}
          />
        ),
      },
      {
        id: "name",
        accessorFn: (item) => firearmDisplayName(item),
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => (
          <>
            <Link
              href={`/firearms/${row.original.id}`}
              aria-label={linkLabel(row.original)}
              className="font-medium text-primary hover:underline"
            >
              {firearmDisplayName(row.original)}
            </Link>
            {hasNickname(row.original) ? (
              <span className="block text-xs font-normal text-muted-foreground">
                {row.original.name}
              </span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: "caliber",
        id: "caliber",
        header: "Caliber",
        meta: { label: "Caliber" },
        cell: ({ getValue }) => (
          <span className="tabular">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "type",
        id: "type",
        header: "Type",
        meta: { label: "Type" },
        cell: ({ getValue }) => firearmTypeLabel(getValue<string>()),
      },
      {
        accessorKey: "action",
        id: "action",
        header: "Action",
        meta: { label: "Action" },
        cell: ({ getValue }) => firearmActionLabel(getValue<string>()),
      },
      {
        accessorKey: "magazineCount",
        id: "magazineCount",
        header: "# Mags",
        meta: { numeric: true, label: "# Mags" },
      },
      {
        accessorKey: "roundTotal",
        id: "roundTotal",
        header: "Rounds",
        meta: { numeric: true, label: "Rounds" },
      },
    ];

    // The Serial column only exists at all when at least one visible firearm
    // has a serial recorded (R71) — preserved from the retired hand-rolled
    // table's `showSerial` gate rather than always offering an empty column.
    if (showSerial) {
      cols.push({
        accessorKey: "serialNumber",
        id: "serialNumber",
        header: "Serial",
        meta: { label: "Serial" },
        optIn: true,
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue<string>()}</span>
        ),
      });
    }

    cols.push(
      {
        accessorKey: "manufacturer",
        id: "manufacturer",
        header: "Manufacturer",
        meta: { label: "Manufacturer" },
        optIn: true,
      },
      {
        accessorKey: "subtype",
        id: "subtype",
        header: "Subtype",
        meta: { label: "Subtype" },
        optIn: true,
      },
      {
        accessorKey: "notes",
        id: "notes",
        header: "Notes",
        meta: { label: "Notes" },
        optIn: true,
      },
      {
        id: ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const item = row.original;
          return item.ownerId === currentUserId ? (
            <div className="flex justify-end gap-1">
              <ShareControl
                parentType="firearm"
                parentId={item.id}
                itemName={firearmDisplayName(item)}
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => requestDelete(item)}
              >
                Delete
              </Button>
            </div>
          ) : null;
        },
      },
    );

    return cols;
  }, [showSerial, currentUserId, requestDelete, linkLabel]);

  // Serial keeps its existing always-on visibility when the column exists
  // (KTD-4): it's grouped with the other opt-in columns for the mobile
  // auto-collapse treatment, but defaults to visible rather than hidden so a
  // firearm list with recorded serials shows them without an extra click.
  const defaultViewState = useMemo(() => {
    const base = createDefaultTableViewState(columns);
    if (!showSerial) return base;
    return {
      ...base,
      columnVisibility: { ...base.columnVisibility, serialNumber: true },
    };
  }, [columns, showSerial]);

  const { viewState, setViewState, mounted } =
    useTableViewState<FirearmViewState>("firearms", {
      ...defaultViewState,
      grouping: "none",
      filters: { type: ALL_TYPES },
    });

  const tableViewState: TableViewState = {
    sorting: viewState.sorting,
    columnVisibility: viewState.columnVisibility,
    pageSize: viewState.pageSize,
  };
  function onTableViewStateChange(next: TableViewState): void {
    setViewState({ ...viewState, ...next });
  }

  // `viewStateRef` mirrors `viewState` on every render so the stale-filter
  // reset effect below always writes on top of the latest view state without
  // re-arming whenever an unrelated view-state field (sorting, grouping, ...)
  // changes — only `isFilterStale` flipping true should trigger the reset.
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

  // Types actually present in the visible list, in canonical order (includes
  // the `unspecified` sentinel when backfilled rows are present) — used to
  // build the filter options so owners can't pick a type with no rows behind
  // it.
  const presentTypes = useMemo(
    () => FIREARM_TYPES.filter((t) => firearms.some((f) => f.type === t)),
    [firearms],
  );
  // Reconcile the selected filter against the live list: after a mutation the
  // previously-selected type may no longer be present, and a `<select>` value
  // with no matching option renders blank.
  const isFilterStale =
    viewState.filters.type !== ALL_TYPES &&
    !presentTypes.some((t) => t === viewState.filters.type);
  // `effectiveFilter` keeps the transient render (before the effect fires)
  // from showing a blank control or filtering on a vanished type.
  const effectiveFilter = isFilterStale ? ALL_TYPES : viewState.filters.type;
  // Clear the stale value in state too, so it can't silently snap back if
  // that type later reappears (e.g. a newly-shared firearm) on an unrelated
  // refresh.
  useEffect(() => {
    if (!isFilterStale) return;
    const current = viewStateRef.current;
    setViewState({
      ...current,
      filters: { ...current.filters, type: ALL_TYPES },
    });
  }, [isFilterStale, setViewState]);

  const filtered = useMemo(
    () =>
      effectiveFilter === ALL_TYPES
        ? firearms
        : firearms.filter((f) => f.type === effectiveFilter),
    [firearms, effectiveFilter],
  );

  function refresh(touchedId?: string) {
    setForm({ open: false });
    // Show every type after a create so the new row (which may be a type the
    // active filter would hide) is visible and its flash lands.
    if (touchedId) {
      setViewState({
        ...viewState,
        filters: { ...viewState.filters, type: ALL_TYPES },
      });
      flash(touchedId);
    }
    router.refresh();
  }

  const filterSlot = (
    <div className="w-48">
      <label
        htmlFor={filterId}
        className="mb-1 block text-xs font-medium text-ink-soft"
      >
        Filter by type
      </label>
      <Select
        id={filterId}
        value={effectiveFilter}
        onChange={(e) =>
          setViewState({
            ...viewState,
            filters: { ...viewState.filters, type: e.target.value },
          })
        }
      >
        <option value={ALL_TYPES}>All types</option>
        {presentTypes.map((t) => (
          <option key={t} value={t}>
            {firearmTypeLabel(t)}
          </option>
        ))}
      </Select>
    </div>
  );

  const groupingSlot = (
    <div className="w-40">
      <label
        htmlFor={groupingId}
        className="mb-1 block text-xs font-medium text-ink-soft"
      >
        Group by
      </label>
      <Select
        id={groupingId}
        value={viewState.grouping}
        onChange={(e) =>
          setViewState({
            ...viewState,
            grouping: e.target.value as GroupingMode,
          })
        }
      >
        <option value="none">None</option>
        <option value="type">By type</option>
      </Select>
    </div>
  );

  const filterEmptyState = (
    // The filter only offers present types and reconciles a stale selection
    // to "all" (see effectiveFilter), so a non-empty list can never filter to
    // zero rows in practice — kept for parity with the DataTable contract.
    <EmptyState
      title="No firearms match your filter"
      description="Try clearing or widening the type filter above."
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Firearms"
        description="Your collection and anything shared with you."
        actions={
          // The cold-start empty state carries its own CTA; only show the
          // toolbar button once there's a collection to act on.
          !form.open && firearms.length > 0 ? (
            <Button onClick={() => setForm({ open: true })}>Add firearm</Button>
          ) : null
        }
      />

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            New firearm
          </h2>
          <FirearmForm
            caliberSuggestions={caliberSuggestions}
            manufacturerSuggestions={manufacturerSuggestions}
            subtypeSuggestions={subtypeSuggestions}
            onDone={refresh}
            onCancel={() => setForm({ open: false })}
          />
        </Card>
      ) : null}

      {firearms.length === 0 && !form.open ? (
        <EmptyState
          title="No firearms yet"
          description="Add your first firearm to start tracking magazine compatibility."
          action={
            <Button onClick={() => setForm({ open: true })}>
              Add your first firearm
            </Button>
          }
        />
      ) : firearms.length > 0 ? (
        !mounted ? (
          <DataTableSkeleton />
        ) : viewState.grouping === "none" ? (
          <DataTable
            columns={columns}
            data={filtered}
            viewState={tableViewState}
            onViewStateChange={onTableViewStateChange}
            mounted
            filterSlot={filterSlot}
            groupingSlot={groupingSlot}
            isRowFlashed={(f) => f.id === flashId}
            emptyState={filterEmptyState}
          />
        ) : (
          <GroupedTableView
            columns={columns}
            data={filtered}
            ownerId={currentUserId}
            keyOf={firearmByTypeKey}
            viewState={tableViewState}
            onViewStateChange={onTableViewStateChange}
            filterSlot={filterSlot}
            groupingSlot={groupingSlot}
            defaultMemberSort={[{ id: "name", desc: false }]}
            emptyFilterState={filterEmptyState}
          />
        )
      ) : null}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${del.target ? firearmDisplayName(del.target) : ""}”?`}
        description="Linked magazines keep their other compatibility. This can’t be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
