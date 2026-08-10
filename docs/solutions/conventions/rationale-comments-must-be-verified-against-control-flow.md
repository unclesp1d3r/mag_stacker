---
title: "Verify a rationale comment against control flow before writing it"
date: 2026-08-09
category: conventions
module: repo-wide
problem_type: convention
component: documentation
severity: high
applies_when:
  - "Writing a doc comment that explains why code is safe — ordering, rollback, locking, visibility, or any 'this cannot happen because…' claim"
  - "Reviewing a comment that asserts a safety property, especially one justifying an unusual-looking choice like an unfiltered read"
  - "Reading a comment that says a check has 'already' run — verify the caller, do not take it on faith"
related_components: [development_workflow, testing_framework]
tags: [comments, code-review, safety-claims, documentation-accuracy, ordering, invariants]
---

# Verify a rationale comment against control flow before writing it

## Context

Working through issue #37, three separate doc comments asserted safety properties the code did not have. Each was written from what the author *intended* the code to do rather than from what it actually did, and each survived a self-review because rereading a comment you just wrote re-confirms the intent, not the behavior.

Two of the three were load-bearing: they described the exact property that was broken, so the comment made the defect *harder* to find than no comment would have.

The three, all in the same change:

1. **A rollback mechanism that never ran.** A guard's comment said throwing "rolls back any scalar update submitted in the same call." The guard runs *before* the update statement, so nothing had been submitted — it prevents the write rather than undoing one. Harmless in effect, wrong in description.
2. **An ordering that was reversed.** A property check's comment said "the caller has already been visibility-gated, so this adds no disclosure." It ran *before* the visibility gate. Submitting an unseeable firearm's id returned a property-specific error instead of not-found, disclosing that the row existed. The comment described the safe design; the code implemented the unsafe one.
3. **A guarantee nothing provided.** A UI filter's comment claimed a separate service guard "means such a link can never legitimately exist anyway." That guard covered one direction only, so the link was reachable. This comment could have led a future reader to delete a real guard as redundant.

## Guidance

**Before writing a comment that asserts a safety property, trace the actual control flow and confirm the claim.** Specifically:

- **"X has already run"** — open the caller and confirm the ordering. This is the highest-risk phrasing in the list, because it describes something outside the function you are looking at, and it is exactly the sentence that makes a reader stop checking.
- **"this rolls back / is undone"** — confirm the statement you claim is undone has actually executed by that point.
- **"Y makes this impossible"** — go read Y and confirm it covers *every* path, not the one you had in mind.
- **"not visibility-scoped, but safe because…"** — the justification is the whole content of the comment; if it is wrong, the comment is actively arguing for a bug.

**Prefer claims a reader can check locally.** "Runs before the scalar update" is verifiable by looking down ten lines. "The caller has already gated this" requires trusting the author. When a property depends on call order, the stronger fix is to make the ordering structural — pass the rule as a post-visibility hook so it *cannot* run early — and let the comment describe a guarantee the code enforces rather than a convention someone must maintain.

**Treat an unusual-looking choice's justification as code, not prose.** These three comments all existed to justify something that looks wrong at a glance (an unfiltered read, a guard that only fires one way). That is precisely when a comment gets trusted instead of checked, and precisely when being wrong is most expensive.

## Why This Matters

A wrong rationale comment is worse than no comment, because it converts a question into a settled answer. A reader who sees an unfiltered read with no explanation investigates; a reader who sees one with a confident "safe because visibility already ran" moves on. In this change that comment sat directly above an information-disclosure bug and argued the bug was fine.

The failure is systematic rather than careless. Comments are written at the moment of *deciding* the behavior, and the decision is the intent — so intent is what gets written down. Then the code drifts a line or two from the intent (a check lands above a gate instead of below it) and nothing re-checks the prose, because comments have no tests.

The cheap defense is a habit, not a process: when you write the word "already", "cannot", or "rolls back", go look.

## When to Apply

- Writing any doc comment whose purpose is to justify safety rather than describe behavior.
- Reviewing a diff with a confident safety claim above unusual-looking code — verify the claim as if it were an assertion, because that is how the next reader will treat it.
- Especially when the comment cites a guarantee from *another* module or a *caller*, which is where the current file gives the reader nothing to check against.

## Examples

Wrong — asserts an ordering the code does not implement:

```ts
/**
 * ...the lookup is NOT visibility-scoped. The caller has already been
 * visibility-gated by `replaceRelation`, so this adds no disclosure.
 */
// ...but this ran BEFORE replaceRelation, so nothing had been gated.
await assertAllMagazineFed(tx, firearmIds);
return replaceRelation(tx, MAGAZINE_FIREARM, actorId, magazineId, firearmIds);
```

Right — the ordering is made structural, and the comment describes what the code now guarantees (`src/domain/magazines/compatibility.ts:82`):

```ts
/**
 * ...the lookup itself is not visibility-scoped. Disclosure is prevented by
 * WHERE this runs instead: it is registered as `replaceRelation`'s
 * post-visibility hook, so every id it sees has already cleared the
 * visibility gate. Never call it before that gate.
 */
```

Right — a claim scoped to what this file actually controls, pointing at the real enforcement rather than asserting it is unnecessary (`app/(app)/magazines/firearm-options.ts:15`):

```ts
/**
 * This filter is presentation only — it shapes what the picker OFFERS, not
 * what the server accepts. The write is refused independently by
 * `assertAllMagazineFed`; do not treat this function as the enforcement point.
 */
```

Related: [a guard is not an invariant](../architecture-patterns/enforcing-a-cross-table-invariant-at-every-write-path.md) — the change these comments were written for, where the same intent-versus-behavior gap produced the underlying defects.

Status: the corrected comments are on the `is_magazine_fed` branch, opened as [PR #108](https://github.com/unclesp1d3r/mag_stacker/pull/108) and unmerged as of this writing.
