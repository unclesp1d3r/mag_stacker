---
title: "A viewer-relative read feeding a replace-all write silently destroys the rows the actor was never shown"
module: compatibility
date: 2026-08-08
problem_type: logic_error
component: authorization
severity: high
root_cause: logic_error
resolution_type: code_fix
related_components:
  - database
  - domain_services
tags:
  - authorization
  - sharing
  - data-loss
  - viewer-relative
  - drizzle
  - grants
---

# A viewer-relative read feeding a replace-all write silently destroys hidden rows

## Problem

Compatibility reads are deliberately viewer-relative: a firearm outside the
reader's visible set is dropped from the result rather than leaking its id. The
write path replaced the set wholesale — delete every row for the parent, then
reinsert what was submitted.

Each half is correct on its own. Together they lose data. The list any caller
submits was necessarily built from a **filtered** view, so its gaps are not
deletions — but the write cannot tell the difference.

## Symptoms

An editor holding a grant on an accessory but not on one of its compatible
firearms opens the edit form, changes an unrelated field (`notes`), and saves.
The link to the firearm they cannot see is gone.

- No error, no warning, no validation failure.
- The editor never knew the link existed — their read omitted it by design.
- The owner is not told, and the next thing they see is a shorter list.
- Every existing test passes, because each rule was tested in isolation.

## What Didn't Work

- **Testing the two rules separately.** There was a passing test for "a firearm
  outside the reader's visible set is dropped" and passing tests for
  "replace-not-merge". Neither can observe the interaction; the bug lives only
  in their composition.
- **Fixing it at the accessory call site.** The obvious patch is in
  `updateAccessory`, where the symptom was reported. That leaves `magazine_firearm`
  broken — it has the identical pairing, on the narrower trigger of a
  cross-owner firearm whose grant was later revoked.
- **Reasoning about the form instead of the data.** "The form round-trips what
  it was given" is true and is exactly why the bug exists. There is no client
  change that fixes it, because the client cannot be told about rows it is not
  allowed to see.

## Solution

Scope the write by the same visible set the read was filtered by
(`src/domain/compatibility/relation.ts`):

```ts
// Always resolved, even for an empty list: the visible set is what bounds the
// delete, so clearing needs it just as much as linking does.
const visible = await getVisibleIds(tx, actorId, "firearm");
for (const id of deduped) {
  if (!visible.has(id)) throw new NotFoundError(...);
}

const existing = await loadStoredRows(tx, relation, parentId);
const preserved = existing.filter((row) => !visible.has(row.firearmId));

if (preserved.length === 0) {
  await tx.delete(relation.table).where(eq(relation.parentIdColumn, parentId));
} else {
  await tx.delete(relation.table).where(
    and(
      eq(relation.parentIdColumn, parentId),
      notInArray(relation.firearmIdColumn, preserved.map((r) => r.firearmId)),
    ),
  );
}
```

Reinserted rows are appended past the highest preserved ordinal, so surviving
order is stable and the actor's requested order is honored within their slice.
No composite-PK collision is possible: preserved rows are invisible to the
actor and every submitted id passed the visibility gate, so the two sets are
disjoint by construction.

The regression tests drive **both** bindings
(`src/domain/compatibility/__tests__/relation.test.ts`), plus one end-to-end
through `updateAccessory` as an edit grantee
(`src/auth/__tests__/accessory-sharing.test.ts`). Both were confirmed to fail
with the fix stashed.

## Why This Works

"Omission clears" is a sound contract only over the domain the actor can
observe. Bounding the delete by the visible set restates the contract as what
it always implicitly was — *clear what you were shown and did not resend* —
instead of *clear everything, including what we hid from you*.

Fixing it in the shared core rather than the reporting call site is the same
argument that put the visibility gate there: a hand-maintained second copy
means a second place an authorization fix has to land, and the copy that gets
missed is the one that loses data.

## Prevention

**When a read is viewer-relative, the corresponding write must be too.** Treat
this as a pair, not two independent decisions. A filtered read hands out an
incomplete picture; any write that treats that picture as authoritative will
delete the difference.

**Look for the pairing during review, not the halves.** Both halves read as
correct in a diff. Grep for the filtered read (`getVisibleIds`, `listVisible*`)
and ask what write consumes its output.

**A new grant-shareable relation inherits this trap.** Anything with a
many-to-many join plus grant-based visibility has the same shape. The core in
`src/domain/compatibility/relation.ts` is the reference implementation.

**Test the composition with a two-user fixture.** One owner, one grantee, and a
row the grantee cannot see. A single-user test can never observe this class of
bug, which is why the suite was green for the entire life of the defect.
