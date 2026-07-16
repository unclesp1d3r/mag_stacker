"use client";

import { format, parseISO } from "date-fns";
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
import type { DateRange } from "react-day-picker";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/surface";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import { useRowFlash } from "@/hooks/use-row-flash";
import { useTableViewState } from "@/hooks/use-table-view-state";
import {
  INVENTORY_PRESET_OPTIONS,
  type InventoryFilterInput,
  type InventoryPreset,
  isInventoryFilterInputShape,
  matchesInventoryFilter,
  sanitizeInventoryFilter,
} from "@/src/domain/magazines/inventory-filter";
import {
  magazineByPrefixKey,
  magazineByTypeKey,
  magazineCapacityAggregate,
} from "@/src/domain/tables/magazine-groups";
import { deleteMagazineAction } from "./actions";
import {
  formatLastInventoried,
  lastInventoriedSortValue,
} from "./last-inventoried";
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
  /** ISO datetime of the most recent "inventoried" log entry; null when never inventoried (U2/U3, #70). */
  lastInventoriedAt: string | null;
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
  /**
   * Preset-or-custom-range inventory-date filter (U4, #70). Kept as the loose
   * `InventoryFilterInput` (not the sanitized `InventoryFilter`) because this is
   * the RAW form value — see `inventoryFilter`/`effectiveInventoryFilter` below.
   */
  inventory: InventoryFilterInput;
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
        // Default-visible counterpart to the opt-in "Acquired" column above
        // (#70): surfaces inventory staleness without an extra click.
        // Never-inventoried must sort as if *infinitely old* — top when
        // ascending (oldest-first), bottom when descending (newest-first) —
        // so the accessor returns a NUMBER (`-Infinity` for never) and lets
        // the built-in `"basic"` comparator handle it: TanStack negates a
        // comparator's result for `desc`, so `-Infinity` naturally flips ends
        // with direction. (`sortUndefined: "first"` would NOT do this — it
        // returns before that `desc` inversion, so it pins undefined rows to
        // the top regardless of sort direction.) The `cell` below still reads
        // the real value off `row.original`, not this numeric accessor.
        id: "lastInventoried",
        accessorFn: (m) => lastInventoriedSortValue(m.lastInventoriedAt),
        sortingFn: "basic",
        header: "Last inventoried",
        meta: { label: "Last inventoried" },
        cell: ({ row }) => (
          <span className="tabular">
            {formatLastInventoried(row.original.lastInventoriedAt)}
          </span>
        ),
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
      filters: {
        query: "",
        caliber: "",
        firearm: "",
        inventory: { preset: "all" },
      },
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
  const inventoryPresetId = useId();
  const inventoryRangeId = useId();
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
  // A persisted inventory filter can be malformed (stale localStorage shape,
  // an unrecognized preset, an unparsable custom-range date) — sanitize it
  // before it ever reaches the predicate, so a bad value degrades to "all"
  // instead of silently matching nothing or throwing on `NaN` bounds.
  // `sanitizeInventoryFilter` returns a fresh object every call, so this is
  // memoized on the (referentially-stable-until-changed) source object —
  // otherwise `effectiveInventoryFilter` would get a new identity on every
  // unrelated re-render, and with it in `filtered`'s deps below, `filtered`
  // would too (the known TanStack autoreset render-loop trigger, see
  // docs/solutions/runtime-errors/tanstack-autoreset-render-loop-unstable-data.md).
  const effectiveInventoryFilter = useMemo(
    () => sanitizeInventoryFilter(viewState.filters.inventory),
    [viewState.filters.inventory],
  );

  const filtered = useMemo(() => {
    const q = viewState.filters.query.trim().toLowerCase();
    const now = new Date();
    return magazines.filter((m) => {
      if (q && !m.brandModel.toLowerCase().includes(q)) return false;
      if (effectiveCaliberFilter && m.caliber !== effectiveCaliberFilter)
        return false;
      if (
        effectiveFirearmFilter &&
        !m.compatibleFirearmIds.includes(effectiveFirearmFilter)
      )
        return false;
      if (
        !matchesInventoryFilter(
          m.lastInventoriedAt,
          effectiveInventoryFilter,
          now,
        )
      )
        return false;
      return true;
    });
  }, [
    magazines,
    viewState.filters.query,
    effectiveCaliberFilter,
    effectiveFirearmFilter,
    effectiveInventoryFilter,
  ]);

  function refresh(touchedId?: string) {
    setForm({ open: false });
    if (touchedId) flash(touchedId);
    router.refresh();
  }

  function openCreate() {
    setForm({ open: true, magpulMode });
  }

  // Unlike effectiveCaliberFilter/effectiveFirearmFilter, the control displays
  // the RAW form value (`viewState.filters.inventory`), not the sanitized one.
  // The sanitized `effectiveInventoryFilter` above feeds ONLY the `filtered`
  // predicate. If the control were driven by the sanitized value instead, a
  // transient invalid state mid-edit — e.g. typing an `after` date later than
  // `before` — would sanitize to `{ preset: "all" }`, which would hide the
  // custom-range panel below (`inventoryFilter.preset === "custom" ? ... :
  // null`) and silently discard both typed dates. Showing the raw input keeps
  // whatever the user actually entered on screen — a semantically-invalid but
  // well-shaped value (e.g. an inverted range) stays visible and editable; the
  // predicate still treats it as "all" until it's corrected.
  //
  // `viewState.filters.inventory` still needs a SHAPE guard, though: it comes
  // from localStorage via `mergeOverDefaults` (`view-state-storage.ts`), which
  // merges `filters` only one level deep with no validation of the nested
  // `inventory` object. A structurally-broken persisted value (`null`, a
  // non-object, an unrecognized `preset`) would otherwise reach `.preset`
  // below and throw, crashing the whole page (KTD-7). `sanitizeInventoryFilter`
  // can't be reused here — it also normalizes semantically-invalid-but-
  // well-shaped values (like an inverted range) to `{ preset: "all" }`, which
  // is exactly the data loss this raw-display path exists to avoid. So this
  // falls back to `{ preset: "all" }` only when the value isn't even
  // well-shaped, matching the fail-safe the caliber/firearm filters already
  // get from their sanitized string values.
  const inventoryFilter: InventoryFilterInput = isInventoryFilterInputShape(
    viewState.filters.inventory,
  )
    ? viewState.filters.inventory
    : { preset: "all" };
  function setInventoryFilter(next: InventoryFilterInput) {
    setViewState({
      ...viewState,
      filters: { ...viewState.filters, inventory: next },
    });
  }

  // The custom-range widget (shadcn's `Calendar` + `Popover`, backed by
  // react-day-picker) works in `DateRange` objects, not the persisted
  // `yyyy-MM-dd` strings — `range` derives one from the raw form value on
  // every render, and `onRangeSelect` converts a selection straight back to
  // those strings via date-fns `format`. Neither the persisted shape nor
  // `matchesInventoryFilter`'s semantics change: this only swaps the widget
  // and its date math (two `<input type="date">` + hand-rolled day-boundary
  // math) for the maintained picker.
  const inventoryRange: DateRange | undefined =
    inventoryFilter.after || inventoryFilter.before
      ? {
          from: inventoryFilter.after
            ? parseISO(inventoryFilter.after)
            : undefined,
          to: inventoryFilter.before
            ? parseISO(inventoryFilter.before)
            : undefined,
        }
      : undefined;
  function onInventoryRangeSelect(next: DateRange | undefined) {
    setInventoryFilter({
      preset: "custom",
      after: next?.from ? format(next.from, "yyyy-MM-dd") : undefined,
      before: next?.to ? format(next.to, "yyyy-MM-dd") : undefined,
    });
  }
  const inventoryRangeLabel = inventoryRange?.from
    ? inventoryRange.to
      ? `${format(inventoryRange.from, "MMM d, yyyy")} – ${format(inventoryRange.to, "MMM d, yyyy")}`
      : `From ${format(inventoryRange.from, "MMM d, yyyy")}`
    : inventoryRange?.to
      ? `Until ${format(inventoryRange.to, "MMM d, yyyy")}`
      : "Pick a date range";

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
      <div className="w-44">
        <label
          htmlFor={inventoryPresetId}
          className="mb-1 block text-xs font-medium text-ink-soft"
        >
          Last inventoried
        </label>
        <Select
          id={inventoryPresetId}
          value={inventoryFilter.preset}
          onChange={(e) => {
            const preset = e.target.value as InventoryPreset;
            // `InventoryFilterInput` allows `after`/`before` alongside any
            // preset, so switching the preset never has to drop them: they
            // stay on the form state (hidden while the panel below isn't
            // shown for a non-custom preset) and reappear as-is when the user
            // re-selects "Custom range…". The predicate ignores them for
            // non-custom presets via `sanitizeInventoryFilter`, so this is
            // purely a form-display concern.
            setInventoryFilter({ ...inventoryFilter, preset });
          }}
        >
          {INVENTORY_PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      {inventoryFilter.preset === "custom" ? (
        <div className="w-64">
          <label
            htmlFor={inventoryRangeId}
            className="mb-1 block text-xs font-medium text-ink-soft"
          >
            Date range
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id={inventoryRangeId}
                variant="outline"
                // A stable accessible name — unlike the visible label below,
                // which changes with the selection — so the trigger stays
                // reliably targetable (by role + name) regardless of state.
                aria-label="Last inventoried date range"
                className="w-full justify-start font-normal"
              >
                {inventoryRangeLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={inventoryRange}
                onSelect={onInventoryRangeSelect}
                defaultMonth={inventoryRange?.from ?? inventoryRange?.to}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
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
