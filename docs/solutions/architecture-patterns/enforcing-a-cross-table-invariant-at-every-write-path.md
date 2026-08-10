---
title: "A guard is not an invariant: enforcing a cross-table rule at every write path"
date: 2026-08-09
category: architecture-patterns
module: domain/compatibility
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Adding a rule that couples two tables — 'rows in B may not reference an A in state X' — where more than one service can write the join"
  - "Reviewing a change that adds a single guard and claims an invariant now holds"
  - "Any new constraint on `magazine_firearm`, `accessory_firearm`, or another relation written through the shared core in `src/domain/compatibility/relation.ts`"
related_components: [database, testing_framework]
tags: [invariants, concurrency, toctou, row-locking, authorization, information-disclosure, compatibility, review-depth]
---

# A guard is not an invariant: enforcing a cross-table rule at every write path

## Context

Issue #37 added `firearm.is_magazine_fed`. The intended rule couples two tables: **no `magazine_firearm` row may reference a firearm whose `is_magazine_fed` is false.**

The first implementation added one guard — `assertNoCompatibleMagazines` in `src/domain/firearms/service.ts:135`, blocking the firearm-side transition into non-magazine-fed while links exist — and treated the invariant as established. The UI reinforced that belief by filtering the picker.

Four successive review passes each found a defect the previous pass could not see, and every one was a narrower version of the same mistake: *confusing a guard on one path with an invariant over all paths.* This is the durable lesson; the specific feature is incidental.

## Guidance

When you add a rule that constrains a relationship between two tables, work this checklist in order. Each step assumes the previous one passed.

### 1. Enumerate every write path, not just the one you touched

Ask: *what code can create the forbidden row?* — not *did I block the thing I was thinking about?*

Here the firearm-side guard blocked `true → false` while links existed, but nothing blocked the reverse: linking a magazine to a firearm that was **already** false. `replaceCompatibility` validated visibility only. The picker filter in `app/(app)/magazines/firearm-options.ts` is presentation and has no bearing on what the server accepts, so a stale form tab or any non-UI caller could write the row the feature assumes cannot exist.

`grep` for every caller of the write helper before concluding coverage.

### 2. Put the rule where it applies — not in the nearest shared helper

The obvious fix is "add the check to the shared write path." That would have been a bug here.

`src/domain/compatibility/relation.ts` is shared by `magazine_firearm` **and** `accessory_firearm`. An optic or light mounting on a revolver is entirely legitimate, so a magazine-only rule pushed into the shared core would silently forbid valid accessory compatibility. The check belongs in the magazine binding (`src/domain/magazines/compatibility.ts:86`), which covers both `createMagazine` and `updateMagazine` while leaving accessories alone.

Before adding a rule to a shared module, list its other consumers and confirm the rule is true for all of them.

### 3. Two guards reading different tables are a TOCTOU pair

Once both directions were guarded, the reads still raced. Under `READ COMMITTED`:

- Tx A (`assertNoCompatibleMagazines`) reads `magazine_firearm`, sees no links, sets the flag false, commits.
- Tx B (`assertAllMagazineFed`) reads `firearm`, sees magazine-fed, inserts the link, commits.

Both pass their own check against a snapshot the other is about to invalidate, and the forbidden state lands.

The fix is a shared lock ordering: **both guards take `SELECT … FOR UPDATE` on the same `firearm` row before their dependent read** (`src/domain/firearms/service.ts:150`, `src/domain/magazines/compatibility.ts:108`). The loser blocks, re-reads the winner's committed row, and rejects. Order multi-row lock acquisition by id so concurrent multi-item submissions cannot deadlock.

### 4. Order authorization before property rules

The property check initially ran *before* the visibility gate. Submitting the id of a firearm the actor could not see returned `ValidationError("does not use detachable magazines")` instead of `NotFoundError` — confirming the firearm exists and disclosing a property of it.

Any rule that can answer a question about a row must run **after** the caller has been proven able to see that row. Here it became an explicit post-visibility hook on the shared relation (`src/domain/compatibility/relation.ts:173`, invoked at `:188` after the gate at `:179`), so the ordering is structural rather than a convention someone must remember.

### 5. Make the test fail before trusting it

Each fix was verified by removing the mechanism and confirming the test failed. That caught a test that could not fail: the concurrency test asserted only that the forbidden end state never landed, which also passes when **both** transactions fail — a deadlock or an erroring lock would have looked identical to success. Under the locking contract exactly one writer must commit, so the test asserts that too.

A test written to prove a fix should be run against the unfixed code at least once.

## Why This Matters

The failure mode is not "someone forgot a check." It is that each layer of scrutiny is blind to the next one down, so a rule can look enforced from every angle you have already thought of:

| Pass | Found | Blind to |
|------|-------|----------|
| Author | guard works | other write paths |
| Agent review | other write path unguarded | concurrent interleaving |
| Bot review | TOCTOU race | the proving test being vacuous |
| Follow-up | vacuous test, leaky error ordering | — |

None of these reviewers would have found all four alone. When a change claims a cross-table invariant, budget for more than one review pass and walk the checklist explicitly rather than trusting that the guard you wrote is the whole rule.

## When to Apply

- Any change adding a constraint between two tables where more than one service writes the relation.
- Reviewing a PR whose description asserts an invariant now holds.
- Specifically for this repo: anything adding a rule to a relation written through `src/domain/compatibility/relation.ts`, because it is shared by magazines and accessories and their rules genuinely differ.

Related: [a viewer-relative read feeding a replace-all write destroys hidden rows](../logic-errors/a-viewer-relative-read-feeding-a-replace-all-write-destroys-hidden-rows.md) — the same module, and the reason the `is_magazine_fed` transition blocks rather than detaching.

## Examples

The final shape — the rule registered as a post-visibility hook rather than called before the gate:

```ts
// src/domain/magazines/compatibility.ts
export async function replaceCompatibility(
  tx: DbOrTx,
  actorId: string,
  magazineId: string,
  firearmIds: string[],
): Promise<string[]> {
  return replaceRelation(
    tx,
    MAGAZINE_FIREARM,
    actorId,
    magazineId,
    firearmIds,
    // Post-visibility hook, NOT called beforehand: an id the actor cannot see
    // must fail as not-found, never as "that firearm is not magazine-fed".
    (visibleIds) => assertAllMagazineFed(tx, visibleIds),
  );
}
```

The lock that serializes the two guards, taken before the dependent read in both:

```ts
// Both sides lock the same firearm row first.
await tx
  .select({ id: firearm.id })
  .from(firearm)
  .where(eq(firearm.id, firearmId))
  .for("update");
```

Status: implemented on the `is_magazine_fed` branch and opened as [PR #108](https://github.com/unclesp1d3r/mag_stacker/pull/108); unmerged as of this writing, so the line references above describe that branch rather than `main`.
