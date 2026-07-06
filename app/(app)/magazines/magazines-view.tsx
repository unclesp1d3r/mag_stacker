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
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/surface";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import { useRowFlash } from "@/hooks/use-row-flash";
import { useTableViewState } from "@/hooks/use-table-view-state";
import {
  magazineByPrefixKey,
  magazineByTypeKey,
  magazineCapacityAggregate,
} from "@/src/domain/tables/magazine-groups";
import { deleteMagazineAction } from "./actions";
import { type FirearmOption, MagazineForm } from "./magazine-form";

export interface MagazineListItem {
  id: string;
  ownerId: string;
  brandModel: string;
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
  label: string;
  acquiredDate: string | null;
  notes: string;
  compatibleFirearmIds: string[];
  compatibleFirearmNames: string[];
}

interface MagazinesViewProps {
  magazines: MagazineListItem[];
  currentUserId: string;
  firearmOptions: FirearmOption[];
  caliberSuggestions: string[];
  /** The owner's used label prefixes, offered as single-add suggestions (#22). */
  prefixOptions: string[];
  /** `prefix -> next sequence number` for single-add label prefill (#22). */
  prefixNextStart: Record<string, number>;
  /** When true the magazine form enforces PMAG dot-matrix label constraints. */
  magpulMode: boolean;
  /** Calibers actually present in the owner's inventory, for the filter select. */
  filterCalibers: string[];
}

// Create-only form state. New magazines are always owned by the current user, so
// the create form uses their own Magpul mode directly. Editing now lives on the
// magazine detail page (owner-only), not here.
type FormState = { open: false } | { open: true; magpulMode: boolean };

type GroupingMode = "none" | "type" | "prefix";

interface MagazineFilters {
  query: string;
  caliber: string;
  firearm: string;
}

interface MagazineViewState extends TableViewState {
  grouping: GroupingMode;
  filters: MagazineFilters;
}

const DEBOUNCE_MS = 250;

export function MagazinesView({
  magazines,
  currentUserId,
  firearmOptions,
  caliberSuggestions,
  prefixOptions,
  prefixNextStart,
  magpulMode,
  filterCalibers,
}: MagazinesViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ open: false });
  const { flashId, flash } = useRowFlash();
  const del = useDeleteConfirmation<MagazineListItem>({
    entityLabel: "Magazine",
    getName: (item) => item.brandModel,
    remove: deleteMagazineAction,
  });
  // `del.request` is a stable `useState` setter; depend column defs on it (not
  // the whole `del`, which is a fresh object each render). Otherwise `columns`
  // rebuilds on every dialog open/close and `flexRender` remounts the actions
  // cell — dropping focus restore and ShareControl's own dialog state.
  const requestDelete = del.request;

  // Same-named magazines get a non-sensitive id-fragment suffix on the row link's
  // accessible name so a screen-reader link list stays unambiguous (R17/R52).
  // The fragment (not the visible label/caliber) avoids colliding with other cells.
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of magazines)
      counts.set(m.brandModel, (counts.get(m.brandModel) ?? 0) + 1);
    return counts;
  }, [magazines]);
  // Read `nameCounts` through a ref so `linkLabel` (and therefore `columns`)
  // keeps a stable identity across data refetches. Otherwise a list refresh —
  // e.g. after a ShareControl grant — rebuilds `columns` and remounts the
  // actions cell, closing ShareControl's dialog mid-flow. The label still
  // reflects current counts because the cell re-renders and reads the ref.
  const nameCountsRef = useRef(nameCounts);
  nameCountsRef.current = nameCounts;
  const linkLabel = useCallback(
    (item: MagazineListItem): string | undefined =>
      (nameCountsRef.current.get(item.brandModel) ?? 0) > 1
        ? `${item.brandModel} (#${item.id.slice(0, 6)})`
        : undefined,
    [],
  );

  const columns = useMemo<ColumnDef<MagazineListItem>[]>(
    () => [
      {
        accessorKey: "brandModel",
        id: "brandModel",
        header: "Brand / model",
        meta: { label: "Brand / model" },
        cell: ({ row }) => (
          <Link
            href={`/magazines/${row.original.id}`}
            aria-label={linkLabel(row.original)}
            className="font-medium text-primary hover:underline"
          >
            {row.original.brandModel}
          </Link>
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
        id: "effectiveCapacity",
        accessorFn: (m) => m.baseCapacity + m.extensionRounds,
        header: "Eff. cap.",
        meta: { numeric: true, label: "Eff. cap." },
      },
      {
        accessorKey: "label",
        id: "label",
        header: "Label",
        meta: { label: "Label" },
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue<string>()}</span>
        ),
      },
      {
        id: "compatible",
        header: "Compatible",
        meta: { label: "Compatible" },
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.compatibleFirearmNames.map((name) => (
              <Badge key={name} tone="neutral">
                {name}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        accessorKey: "notes",
        id: "notes",
        header: "Notes",
        meta: { label: "Notes" },
        optIn: true,
      },
      {
        accessorKey: "acquiredDate",
        id: "acquiredDate",
        header: "Acquired",
        meta: { label: "Acquired" },
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
                parentType="magazine"
                parentId={item.id}
                itemName={item.brandModel}
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
    ],
    [currentUserId, requestDelete, linkLabel],
  );

  const { viewState, setViewState, mounted } =
    useTableViewState<MagazineViewState>("magazines", {
      ...createDefaultTableViewState(columns),
      grouping: "none",
      filters: { query: "", caliber: "", firearm: "" },
    });

  const tableViewState: TableViewState = {
    sorting: viewState.sorting,
    columnVisibility: viewState.columnVisibility,
    pageSize: viewState.pageSize,
  };
  function onTableViewStateChange(next: TableViewState): void {
    setViewState({ ...viewState, ...next });
  }

  // Search input keeps local state and debounces into the persisted filter
  // (mirrors the retired FilterBar's behavior, R71).
  const [queryInput, setQueryInput] = useState(viewState.filters.query);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const caliberId = useId();
  const firearmId = useId();
  const groupingId = useId();

  // `viewStateRef` mirrors `viewState` on every render so the debounced commit
  // below always writes on top of the latest view state without re-arming the
  // timer whenever unrelated view-state fields (sorting, grouping, ...) change.
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

  // `queryInput` seeds from `viewState.filters.query` while it's still the
  // pre-mount default (""). Once `useTableViewState` restores the persisted
  // value from localStorage (`mounted` flips to true), sync the box to it —
  // otherwise a restored non-empty query would filter silently while the
  // input itself still showed empty (KTD-7).
  useEffect(() => {
    if (mounted) setQueryInput(viewStateRef.current.filters.query);
  }, [mounted]);

  useEffect(() => {
    if (queryInput === viewStateRef.current.filters.query) return;
    const handle = setTimeout(() => {
      const current = viewStateRef.current;
      setViewState({
        ...current,
        filters: { ...current.filters, query: queryInput },
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [queryInput, setViewState]);

  // Keyboard accelerator: "/" focuses the search box when no input is focused.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A persisted `caliber`/`firearm` filter can point at an option that no
  // longer exists in the live inventory (the caliber/firearm disappeared
  // since the value was saved). Treat a filter value absent from the current
  // options as inactive rather than filtering the list to zero rows with a
  // blank-looking `<Select>` (mirrors the firearms view's stale-filter
  // handling). Kept simple per KTD-7: only the *effective* filter ignores the
  // stale value — the persisted state itself isn't rewritten.
  const effectiveCaliberFilter = filterCalibers.includes(
    viewState.filters.caliber,
  )
    ? viewState.filters.caliber
    : "";
  const effectiveFirearmFilter = firearmOptions.some(
    (f) => f.id === viewState.filters.firearm,
  )
    ? viewState.filters.firearm
    : "";

  const filtered = useMemo(() => {
    const q = viewState.filters.query.trim().toLowerCase();
    return magazines.filter((m) => {
      if (q && !m.brandModel.toLowerCase().includes(q)) return false;
      if (effectiveCaliberFilter && m.caliber !== effectiveCaliberFilter)
        return false;
      if (
        effectiveFirearmFilter &&
        !m.compatibleFirearmIds.includes(effectiveFirearmFilter)
      )
        return false;
      return true;
    });
  }, [
    magazines,
    viewState.filters.query,
    effectiveCaliberFilter,
    effectiveFirearmFilter,
  ]);

  function refresh(touchedId?: string) {
    setForm({ open: false });
    if (touchedId) flash(touchedId);
    router.refresh();
  }

  function openCreate() {
    setForm({ open: true, magpulMode });
  }

  const filterSlot = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-48">
        <label
          htmlFor={searchId}
          className="mb-1 block text-xs font-medium text-ink-soft"
        >
          Search brand / model{" "}
          <span className="text-muted-foreground">( / )</span>
        </label>
        <Input
          id={searchId}
          ref={searchRef}
          placeholder="e.g. PMAG"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
        />
      </div>
      <div className="w-40">
        <label
          htmlFor={caliberId}
          className="mb-1 block text-xs font-medium text-ink-soft"
        >
          Caliber
        </label>
        <Select
          id={caliberId}
          value={effectiveCaliberFilter}
          onChange={(e) =>
            setViewState({
              ...viewState,
              filters: { ...viewState.filters, caliber: e.target.value },
            })
          }
          disabled={filterCalibers.length === 0}
        >
          <option value="">All calibers</option>
          {filterCalibers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-48">
        <label
          htmlFor={firearmId}
          className="mb-1 block text-xs font-medium text-ink-soft"
        >
          Compatible firearm
        </label>
        <Select
          id={firearmId}
          value={effectiveFirearmFilter}
          onChange={(e) =>
            setViewState({
              ...viewState,
              filters: { ...viewState.filters, firearm: e.target.value },
            })
          }
        >
          <option value="">Any firearm</option>
          {firearmOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.hint ? ` (${f.hint})` : ""}
            </option>
          ))}
        </Select>
      </div>
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
        <option value="prefix">By label prefix</option>
      </Select>
    </div>
  );

  const filterEmptyState = (
    <EmptyState
      title="No magazines match your filters"
      description="Try clearing or widening the filters above."
    />
  );

  return (
    <div className="space-y-5">
      {/* When the inventory is truly empty the empty state owns the add CTA;
          show this toolbar button only once there are rows. Filtering is
          client-side now, so an active filter never changes this — the
          unfiltered `magazines` prop is what distinguishes cold-start from
          a normal (possibly filtered-to-zero) inventory. */}
      {!form.open && magazines.length > 0 ? (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Add magazine</Button>
        </div>
      ) : null}

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            New magazine
          </h2>
          <MagazineForm
            firearmOptions={firearmOptions}
            caliberSuggestions={caliberSuggestions}
            prefixOptions={prefixOptions}
            prefixNextStart={prefixNextStart}
            magpulMode={form.magpulMode}
            onDone={refresh}
            onCancel={() => setForm({ open: false })}
          />
        </Card>
      ) : null}

      {magazines.length === 0 && !form.open ? (
        firearmOptions.length === 0 ? (
          // Cold start: no firearms and no magazines. Point at the path to the
          // payoff — compatibility mapping needs a firearm first.
          <EmptyState
            title="Set up your inventory"
            description="MagStacker maps which magazines fit which firearms. Start with a firearm, then add the magazines that feed it."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={() => router.push("/firearms")}>
                  Add a firearm
                </Button>
                <Button variant="ghost" onClick={openCreate}>
                  Start with a magazine
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            title="No magazines yet"
            description="Add a magazine — single, or bulk-add a labeled batch."
            action={
              <Button onClick={openCreate}>Add your first magazine</Button>
            }
          />
        )
      ) : magazines.length > 0 ? (
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
            isRowFlashed={(m) => m.id === flashId}
            emptyState={filterEmptyState}
          />
        ) : (
          <GroupedTableView
            columns={columns}
            data={filtered}
            ownerId={currentUserId}
            keyOf={
              viewState.grouping === "type"
                ? magazineByTypeKey
                : (m) => magazineByPrefixKey(m, prefixOptions)
            }
            aggregateOf={magazineCapacityAggregate}
            renderAggregate={(total) => `· ${total} rds`}
            viewState={tableViewState}
            onViewStateChange={onTableViewStateChange}
            filterSlot={filterSlot}
            groupingSlot={groupingSlot}
            defaultMemberSort={[{ id: "label", desc: false }]}
            emptyFilterState={filterEmptyState}
          />
        )
      ) : null}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${del.target?.brandModel}”?`}
        description="This removes the magazine from your inventory and can’t be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
