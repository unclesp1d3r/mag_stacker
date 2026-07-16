---
title: Date-boundary unit tests drift when they assert UTC instants against local-day logic
date: 2026-07-15
category: test-failures
module: magazines/inventory-filter
problem_type: test_failure
component: testing_framework
symptoms:
  - "A date-boundary unit test passes in UTC CI but fails on a developer machine in a UTC+ timezone."
  - "matchesInventoryFilter returns the opposite of the expected boolean for an instant right at a day boundary, depending on the runner's TZ."
root_cause: logic_error
resolution_type: test_fix
severity: low
related_components:
  - magazines
tags: [timezone, date-fns, local-day, unit-testing, boundary-conditions, toisostring, flaky-test]
---

# Date-boundary unit tests drift when they assert UTC instants against local-day logic

## Problem

A unit test asserted a hard-coded UTC instant (`"2026-01-31T23:30:00.000Z"`) against a predicate that resolves its day bounds in the *viewer's local timezone*. The test passed in UTC CI but would fail on any developer machine at a positive UTC offset — a latent, environment-dependent failure that CI can never catch because CI runs in UTC.

## Symptoms

- `matchesInventoryFilter("2026-01-31T23:30:00.000Z", { preset: "custom", after: "2026-01-01", before: "2026-01-31" }, NOW)` returns `true` on a UTC runner but `false` at UTC+1 (the instant is `2026-02-01T00:30` *local*, past the local end-of-day for Jan 31).
- The mirror case: `"2026-01-01T00:00:00.000Z"` returns `true` in UTC but `false` at UTC−1 (it is `2025-12-31T23:00` local, before the local start-of-day for Jan 1).
- Green in CI, red only on some contributors' laptops.

## What Didn't Work

- **Trusting the green CI run.** The 37-test suite passed unmodified through a hand-rolled → `date-fns` refactor, which read as "behavior preserved." It only proved the tests agreed with the code *in UTC* — both the fragile literals and the CI runner shared the same zone, so the bug was invisible.

## Solution

Construct the boundary instants in **local time** so the test's expectation is computed in the same frame the predicate uses. In `src/domain/magazines/__tests__/inventory-filter.test.ts`:

```ts
// Before — UTC literal, drifts across the day boundary on non-UTC runners:
expect(
  matchesInventoryFilter("2026-01-31T23:30:00.000Z", range, NOW),
).toBe(true);

// After — local-time construction, deterministic on any runner:
expect(
  matchesInventoryFilter(
    new Date(2026, 0, 31, 23, 30).toISOString(), // local Jan 31 23:30 → serialized
    range,
    NOW,
  ),
).toBe(true);
```

`new Date(year, monthIndex, day, h, m)` builds the instant in the runner's local zone; `.toISOString()` then serializes it (as UTC) for the string-typed predicate input. The *local calendar day* is now fixed regardless of offset, so it always lands inside the local `[startOfDay(after), endOfDay(before)]` window.

## Why This Works

The production predicate resolves its bounds in local time. In `src/domain/magazines/inventory-filter.ts` the `custom` branch does:

```ts
const entry = parseISO(lastInventoriedAt);
if (filter.after && isBefore(entry, startOfDay(parseISO(filter.after)))) return false;
if (filter.before && isAfter(entry, endOfDay(parseISO(filter.before)))) return false;
```

`parseISO("2026-01-31")` (a date-only string) yields **local** midnight, and date-fns `startOfDay`/`endOfDay` operate in local time — so `before` covers through `2026-01-31T23:59:59.999` *local*. The `entry`, however, is an absolute instant. A UTC literal like `...T23:30:00.000Z` is a *fixed point on the timeline*; which local calendar day it falls on depends on the runner's offset. At UTC+1 that instant is already Feb 1 locally, so `isAfter(entry, endOfDay(local Jan 31))` is true and the row is excluded — the opposite of the UTC result. Building the instant from local Y/M/D removes the offset dependency: the assertion pins a local wall-clock time, matching how the predicate reasons.

## Prevention

- **Match the test's time frame to the code under test.** If the SUT interprets dates in local time (`parseISO` on a date-only string, `startOfDay`/`endOfDay`, `new Date(y, m, d)`), construct test fixtures with `new Date(y, monthIndex, d, ...)`, **not** UTC `...Z` literals or `toISOString()`-derived day strings. If the SUT works in UTC (`Date.UTC`, `parseISO` on a `...Z` timestamp), use UTC literals. Never mix frames across the assertion.
- **A green UTC CI run is not evidence of timezone-correctness.** CI almost always runs in UTC, so it structurally cannot catch UTC-vs-local drift. Treat any date-boundary assertion as suspect until it has been reasoned about (or run) at a non-zero offset — e.g. `TZ=America/New_York bun test` or `TZ=Asia/Tokyo bun test` locally.
- **Boundary values are where this bites.** Mid-interval fixtures (a date ~15 days inside a month range) are robust to a ±1-day offset shift; only instants within ~1 day of a `startOfDay`/`endOfDay` edge flip. When testing inclusivity of a day boundary, that closeness is the whole point — so those are exactly the assertions that must be built in the local frame.

## Related Issues

- Introduced during the last-inventoried inventory-date filter (PR #70 / #72); the local-frame fix landed in the PR #72 review round.
- Related tests-failures learnings (different root causes): `docs/solutions/test-failures/bun-test-misloads-playwright-e2e-specs.md`, `docs/solutions/test-failures/e2e-dotenv-mise-clobbers-launcher-env.md`.
