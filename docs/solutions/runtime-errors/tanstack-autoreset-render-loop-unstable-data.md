---
title: TanStack Table autoReset infinite render loop from an unstable data prop
date: 2026-07-05
category: docs/solutions/runtime-errors
module: components/ui/data-table
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - "Page main thread hangs when expanding a grouped table row (or any local state change that re-renders the component holding useReactTable)"
  - "Playwright e2e keyboard.press/click times out at the interaction and spends its whole budget blocked"
  - "CI e2e fails under headless/software rendering while the same test passes locally on a GPU machine"
  - "CPU profile of the blocked thread is dominated by ReactElement / jsxDEV / createElement (continuous element creation) with NO 'Maximum update depth exceeded' error"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [react, tanstack-table, usereacttable, render-loop, autoreset, usememo, react-compiler]
---

# TanStack Table autoReset infinite render loop from an unstable data prop

## Problem

A component that calls `useReactTable({ data: someArray.filter(...) })` — passing a **freshly built array every render** — can drive React into an infinite render loop that pegs the renderer main thread. In this repo it surfaced in `GroupedTableView`: expanding a group hung the page. The loop is timing-sensitive — it can pass on a fast machine and hang on a slower/headless one (CI).

## Symptoms

- Expanding a grouped table row (any interaction that re-renders the component owning `useReactTable`) freezes the page.
- Playwright `keyboard.press("Enter")` / `.click()` on the trigger **times out** — the input event can't be processed because the main thread is stuck; the whole 30s/90s test budget is consumed at that one line.
- CI's `e2e` job fails while local `just ci-check` (same production build) passes — the loop settles fast enough on a GPU/fast CPU but not on GitHub's headless, software-rendered runner.
- A CPU profile of the hung thread shows nonstop `ReactElement`, `jsxDEV`, `createElement`, `beginWork` — continuous element creation, i.e. a render loop.
- Crucially, **no `Maximum update depth exceeded` console error** — React's guard only catches setState-*during-render*; this loop is driven by TanStack scheduling updates in response to a changed `data` identity, so the guard never fires and there's no error to grep for.

## What Didn't Work

- **Blaming Radix Collapsible / ResizeObserver.** The grouped view first used a per-group `<Collapsible>`; removing its height animation and moving the member table's `overflow-x-auto` to a single outer container did **not** fix CI. (Red herring — the block reproduced even after the Collapsible was gone.)
- **Raising the Playwright test timeout** (30s → 90s). It just let the blocked interaction consume more time; the test still failed, now at ~90s.
- **Switching the expand interaction** from pointer click to `focus()` + keyboard `Enter`, and to `{ force: true }`. Both still timed out — the input method was never the issue; the main thread was blocked.
- **CPU-throttling locally to mimic CI** (`Emulation.setCPUThrottlingRate`). Inconclusive on its own — throttling slows the whole flow (login, nav), muddying the signal; the clean reproduction only came once the rewrite made the loop fire on every re-render locally.

## Solution

`useMemo` every array passed as `data` to `useReactTable`, keyed on the real inputs:

```tsx
// BEFORE — new array identity every render → autoReset loop
const ownedData = data.filter((row) => row.ownerId === ownerId);
const borrowed  = data.filter((row) => row.ownerId !== ownerId);
const table         = useReactTable({ data: ownedData, /* ... */ });
const borrowedTable = useReactTable({ data: borrowed,  /* ... */ });

// AFTER — stable identity while inputs are unchanged
const ownedData = useMemo(
  () => data.filter((row) => row.ownerId === ownerId),
  [data, ownerId],
);
const borrowed = useMemo(
  () => data.filter((row) => row.ownerId !== ownerId),
  [data, ownerId],
);
```

See `components/ui/data-table/grouped-table-view.tsx`. After the fix the same e2e that timed out at 90s passes in ~0.8s.

## Why This Works

`useReactTable` runs `autoReset*` logic (`autoResetPageIndex`, `autoResetExpanded`, …, on by default) that fires when it detects the `data` reference changed. Firing schedules an internal state update → the component re-renders → `data.filter(...)` produces a **new array reference** → TanStack again thinks data changed → autoReset fires again → loop. It stays dormant until the component re-renders for some *other* reason (here: local `useState` expand state); with a stable Radix-owned open-state the component didn't re-render, so the loop never armed locally — which is exactly why it looked like a Collapsible bug and why CI-only failures were so confusing. Memoizing `data` gives it a stable identity across re-renders, so autoReset sees "no change" and never schedules the update.

## Prevention

- **Never pass an inline `.filter()`/`.map()`/`buildX()` array as `useReactTable({ data })`.** Always `useMemo` it (or hoist it to a stable source). This is the single most important rule when adopting TanStack Table.
- When a component holds a `useReactTable` **and** its own `useState`, assume any state change will re-run the table options — so every option that's a fresh object/array (`data`, `columns`, `state` slices) must be stable or memoized.
- A hang with **no** `Maximum update depth` error is the tell for a *scheduler-driven* loop (external store / library autoReset), not a setState-in-render loop. Reach for a CPU profile: continuous `ReactElement`/`jsxDEV` self-time = a render loop.
- CI-only hangs that pass locally are often a fast-vs-slow-CPU or GPU-vs-software-rendering difference exposing a latent loop or O(n^2) — reproduce by making the component re-render on its own state, not by hunting the rendering environment.
- Related bulk-add O(n^2) cleanups in the same PR: build accumulator arrays with `.push(...)` into a get-or-created bucket rather than `[...existing, row]` on every element (`src/domain/tables/grouping.ts`, `grouped-table-view.tsx`).

## Related Issues

- `hooks/use-table-view-state.ts` and the shared `DataTable` wrapper carry a separate but related stability lesson: under React Compiler (`reactCompiler: true`), passing the referentially-stable-but-internally-mutating `table` object to a memoized child renders it stale — pass reactive value slices instead.
- PR #48 (shared data-table + roll-up grouping) is where this was diagnosed and fixed.
