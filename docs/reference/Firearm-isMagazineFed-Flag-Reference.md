# Firearm `isMagazineFed` Flag Reference

## Overview

`isMagazineFed` is a boolean flag on the `Firearm` entity that records whether a firearm uses detachable magazines. It was introduced in [PR #108](https://github.com/unclesp1d3r/mag_stacker/pull/108) to solve two concrete UX problems:

1. **Misleading magazine counts.** Before this flag, every firearm showed a `# Mags` count of `0`. For a Glock that genuinely has no magazines loaded yet, `0` is informative—it tells the owner to go add some. For a Ruger GP100 revolver, `0` is wrong: the firearm does not take detachable magazines at all, and the `0` looks like missing data rather than a design property of the gun.

2. **Nonsensical compatibility options.** The magazine form's compatible-firearm picker listed every firearm the owner had, including revolvers, break-action shotguns, tube-fed lever guns, and muzzleloaders. Associating a detachable magazine with any of those makes no sense, and the data model previously had no way to prevent it.

### Why an explicit flag rather than taxonomy-derived inference

Mag Stacker already has a firearm type/action taxonomy (Issue #17). It might seem natural to derive magazine-fed status from `action = "revolver"` or `type = "shotgun"`, but the mapping is lossy in both directions:

- A tube-fed lever gun and a break-action shotgun share no single action value.
- Some bolt-action rifles are magazine-fed and some are not.
- A future taxonomy entry could change the inferred result without the owner ever touching the flag.

An owner-set flag is **authoritative and simple**. It records exactly the owner's intent and does not silently change meaning when the taxonomy grows. Taxonomy-driven *defaults* remain a possible future enhancement, but the stored flag stays the source of truth either way [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Scope

This flag affects:

- Firearm form (checkbox on create and edit)
- Magazine count rendering across three UI surfaces
- Compatible-firearm options in the magazine create and edit forms
- The compatible-firearm filter dropdown on the magazines list page
- Service-layer validation when toggling the flag off

It does **not** affect accessory compatibility (accessories fit firearms, not magazines) and does not change the compatibility relation's viewer-relative semantics.

## Data Model

### Schema

The flag is stored as a non-null PostgreSQL boolean column on the `firearm` table:

```ts
// src/db/inventory-schema.ts
isMagazineFed: boolean("is_magazine_fed").notNull().default(true),
```

This declaration follows the same Drizzle pattern as the adjacent `isNfa` field [[2]](https://github.com/unclesp1d3r/mag_stacker/blob/4a85247643ef6202d8a93dada47451b2cffad4f1/src/db/inventory-schema.ts#L94-L96):

| Property | Value |
|----------|-------|
| TypeScript property | `isMagazineFed` |
| Database column | `is_magazine_fed` |
| Type | `boolean` |
| Nullable | No (`NOT NULL`) |
| Default | `true` |

The positive polarity (`isMagazineFed`) with `DEFAULT true` was chosen deliberately—it makes the backfill semantically correct with no data migration, and it avoids double-negatives (`isNotMagazineFed = false`) at every call site [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Migration

Migration `0023_crazy_spirit.sql` adds the column with a single statement [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```sql
ALTER TABLE "firearm" ADD COLUMN "is_magazine_fed" boolean DEFAULT true NOT NULL;
```

The `DEFAULT true` clause is the backfill. PostgreSQL applies it immediately to every existing row, so all pre-existing firearms are treated as magazine-fed. No separate `UPDATE` statement is needed, and today's behavior is preserved exactly.

### Default value

The default of `true` reflects the reality that the overwhelming majority of firearms are magazine-fed. When a caller omits the flag (for example, an older API client or a restored backup that predates the column), the firearm is treated as magazine-fed—the safe, conservative choice that preserves existing associations and display behavior.

## UI and User Workflow

### Firearm form

The firearm form exposes the flag as a checkbox labeled **"This firearm uses detachable magazines"** [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). It sits next to the "NFA-regulated item" checkbox.

**Creating a new firearm:** the checkbox is checked by default, because the overwhelming majority of firearms are magazine-fed. Uncheck it for revolvers, break-actions, tube-fed lever guns, muzzleloaders, and any other firearm that does not accept a detachable magazine.

**Editing an existing firearm:** the checkbox reflects the stored value. Checking or unchecking it and saving will update the flag—subject to the validation rule described in the next section.

### Error display

When the server guard rejects a non-magazine-fed transition (because compatible magazines still exist), the error message appears **inline**, directly below the checkbox [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). The checkbox also receives `aria-invalid="true"` and is wired to the error paragraph via `aria-describedby`, so assistive technology reads the message as part of the field. The error does not appear in the generic form error banner.

> **Example error message:**
> *"Remove this firearm's compatible magazines before marking it non-magazine-fed"*

The rejection does not persist: reloading the edit form shows the firearm still magazine-fed, with the checkbox checked.

## Validation Rules

### The guard

You **cannot** mark a firearm as non-magazine-fed if any `magazine_firearm` row currently references it [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). The guard runs inside `updateFirearm`'s database transaction, after authorization, and throws `ValidationError` with code `magazineFedHasCompatibleMagazines` if the check fails.

The guard fires **only** when `input.isMagazineFed === false`. Unrelated edits (renaming a firearm, changing its caliber, toggling `isNfa`) do not trigger it, even when the firearm already has compatible magazines [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). Turning the flag back *on* always succeeds—no guard is needed in that direction.

`createFirearm` has no guard because a brand-new firearm cannot yet have compatibility rows.

### Cross-owner protection

The guard queries `magazine_firearm` **without a visibility filter** [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). This is deliberate. Consider a shared firearm: owner A grants owner B view permission, and owner B links one of their magazines to it. Owner A cannot see owner B's magazine. If the guard were visibility-filtered, owner A could toggle the firearm to non-magazine-fed while owner B's link survived the query—but nothing would stop owner A from also triggering a detach. Worse, there is no safe way to "detach on toggle" in this application at all (see [Why block, not detach](#why-block-not-detach) below).

The error message is intentionally generic—it discloses only that *some* compatibility link exists, not whose or which magazine it is.

### Why block, not detach

An earlier version of Issue #37 suggested warn-and-detach as an alternative. That alternative was rejected because it is actively unsafe in this codebase.

[`src/domain/compatibility/relation.ts`](https://github.com/unclesp1d3r/mag_stacker/blob/4a85247643ef6202d8a93dada47451b2cffad4f1/src/domain/compatibility/relation.ts) is deliberately viewer-relative on *both* read and write. A filtered read hands out an incomplete picture; a write that treats that picture as the complete set will destroy rows the actor was never shown. This is exactly the failure mode documented in [the viewer-relative-read solution](https://github.com/unclesp1d3r/mag_stacker/blob/4a85247643ef6202d8a93dada47451b2cffad4f1/docs/solutions/logic-errors/a-viewer-relative-read-feeding-a-replace-all-write-destroys-hidden-rows.md):

> *"An editor holding a grant on an accessory but not on one of its compatible firearms opens the edit form, changes an unrelated field, and saves. The link to the firearm they cannot see is gone."*

A detach-on-toggle would build its delete list from a visibility-filtered read of `magazine_firearm` and silently destroy compatibility rows belonging to other owners' magazines. Blocking has none of that failure mode: the invariant "a non-magazine-fed firearm has no compatibility rows" is enforced as a whole-table data-integrity property, not a per-actor view.

### Transaction rollback

The guard runs inside `updateFirearm`'s transaction. If it throws, the entire transaction rolls back—including any scalar changes (name, caliber, etc.) submitted in the same call. A firearm that the guard rejects remains unchanged in the database [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Validation error details

| Property | Value |
|----------|-------|
| Error class | `ValidationError` |
| Error code | `magazineFedHasCompatibleMagazines` |
| User-facing message | `"Remove this firearm's compatible magazines before marking it non-magazine-fed"` |
| Surfaced on | The "This firearm uses detachable magazines" checkbox |
| Rollback | Yes — the entire `updateFirearm` transaction is rolled back |

## UI Rendering Behavior

### The `magazineCountValue` helper

All three magazine-count surfaces share a single rendering helper [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```ts
// app/(app)/firearms/magazine-count.tsx
export function magazineCountValue(
  isMagazineFed: boolean,
  count: ReactNode,
): ReactNode {
  if (!isMagazineFed) {
    return <span className="text-muted-foreground">—</span>;
  }
  return count;
}
```

The critical invariant is in the JSDoc: **keyed off the flag, never off `count === 0`**. A magazine-fed firearm that genuinely has no magazines yet shows `0`—that is useful signal to the owner. The em dash means "this firearm does not take detachable magazines", not "this firearm has zero magazines".

Using a shared helper ensures the three surfaces can never disagree about the same firearm. Each surface passes its already-rendered count as the `count` argument, preserving the numeric treatment (plain number vs. `<Data>` span) that each surface already had.

### Firearms table — "# Mags" column

The `# Mags` column in the firearms table uses a `cell` renderer that reads `row.original.isMagazineFed` [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

- **Non-magazine-fed** (e.g. a revolver): renders a muted `—`
- **Magazine-fed with 0 magazines**: renders `0`
- **Magazine-fed with magazines**: renders the numeric count

Sorting remains on the underlying numeric `magazineCount` value, so non-magazine-fed rows sort as `0`.

### Firearm detail view — "Compatible magazines" row

The detail view's *Compatible magazines* row wraps its count in `magazineCountValue` [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

- **Non-magazine-fed**: shows a muted `—`
- **Magazine-fed**: shows the `<Data>` span with the count (including `0`)

### Summary page — per-firearm "Compatible mags" column

The summary tables' per-firearm **Compatible mags** column uses the same `magazineCountValue` helper via the column's `cell` renderer [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

- **Non-magazine-fed**: renders `—`
- **Magazine-fed**: renders the count

The `FirearmCount` interface in `src/domain/summary/summary.ts` carries an `isMagazineFed: boolean` field, and `computeSummary` populates it from `f.isMagazineFed ?? true` (treating absent as magazine-fed for backward compatibility) [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Concrete examples

| Firearm | isMagazineFed | Magazines linked | Renders as |
|---------|--------------|-----------------|------------|
| Ruger GP100 (revolver) | `false` | 0 | `—` |
| Stevens 311 (break-action) | `false` | 0 | `—` |
| Glock 19 (new, no mags yet) | `true` | 0 | `0` |
| Glock 19 (with 3 mags) | `true` | 3 | `3` |

## Magazine Compatibility

### Filtering compatible-firearm options

Non-magazine-fed firearms are excluded from `firearmOptions` on both the magazine create page and the magazine edit page [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). This is handled by `magazineFedOptions()`:

```ts
// app/(app)/magazines/firearm-options.ts
export function magazineFedOptions(
  firearms: readonly OptionSource[],
): FirearmOption[] {
  const selectable = firearms.filter((f) => f.isMagazineFed);
  const nameCounts = new Map<string, number>();
  for (const f of selectable) {
    nameCounts.set(f.name, (nameCounts.get(f.name) ?? 0) + 1);
  }
  return selectable.map((f) => ({
    id: f.id,
    name: f.name,
    hint: (nameCounts.get(f.name) ?? 0) > 1 ? f.id.slice(0, 6) : undefined,
  }));
}
```

The same filtered list also feeds the **compatible-firearm filter dropdown** on the magazines list page. Since the validation guard prevents a non-magazine-fed firearm from ever having compatibility rows through the app, filtering this dropdown is safe—it would always yield zero results anyway [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Name disambiguation

The same-name disambiguation hint (a short ID fragment appended to duplicate names) is computed over the **filtered** list only. A collision between a selectable magazine-fed firearm and a non-selectable non-magazine-fed firearm with the same name is not treated as a collision—the hint would be noise for the non-selectable entry that nobody can pick [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### The `nameById` asymmetry

The `nameById` map (used to resolve compatibility IDs to display names) is deliberately built from the **unfiltered** firearm list [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```ts
// app/(app)/magazines/page.tsx and app/(app)/magazines/[id]/page.tsx
// UNFILTERED on purpose — see `magazineFedOptions`.
const nameById = new Map(firearms.map((f) => [f.id, f.name]));
const firearmOptions = magazineFedOptions(firearms);
```

This asymmetry is intentional. The validation guard makes it impossible to create a `magazine_firearm` row linking to a non-magazine-fed firearm through the app. However, a restored backup or a direct database edit could produce one. In that edge case, the magazine's compatible-firearm badge should still render the firearm's name rather than going blank. Filtering `nameById` would silently blank an existing badge instead of surfacing the inconsistency [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

## Empty State Handling

The magazines list has a cold-start empty state that directs new users to add a firearm first ("Set up your inventory / Add a firearm"). Before PR #108, this state was gated on `firearmOptions.length === 0`—that is, whether the user had any *compatible-firearm options*.

After PR #108, the gate uses an explicit `hasFirearms` prop instead [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```tsx
// app/(app)/magazines/magazines-view.tsx
{magazines.length === 0 && !form.open ? (
  !hasFirearms ? (
    // Cold start: no firearms and no magazines.
    <EmptyState ... />
  ) : (
    // Has firearms but no magazines yet.
    ...
  )
) : null}
```

`hasFirearms` is `firearms.length > 0`—it is `true` if the owner has **any** firearm, magazine-fed or not [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

**Why this matters:** An owner whose inventory consists only of a revolver and a break-action shotgun has firearms. They are not in the same situation as a brand-new user who has added nothing yet. Before the fix, filtering `firearmOptions` to only magazine-fed firearms would have left `firearmOptions.length === 0` for that owner, incorrectly showing the "Add a firearm" cold-start prompt to someone who already has firearms in their inventory.

## Developer Guidelines

### Service layer

**`createFirearm`** (`src/domain/firearms/service.ts`) persists the flag via `persistableFields`, defaulting to `true` when the input omits it [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```ts
isMagazineFed: input.isMagazineFed ?? true,
```

No guard runs on create—a brand-new firearm cannot have compatibility rows.

**`updateFirearm`** runs the guard when `input.isMagazineFed === false`, inside the update transaction, after authorization [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```ts
if (input.isMagazineFed === false) {
  await assertNoCompatibleMagazines(tx, id);
}
```

**`assertNoCompatibleMagazines`** queries `magazine_firearm` without a visibility filter [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```ts
async function assertNoCompatibleMagazines(
  tx: DbOrTx,
  firearmId: string,
): Promise<void> {
  const [linked] = await tx
    .select({ magazineId: magazineFirearm.magazineId })
    .from(magazineFirearm)
    .where(eq(magazineFirearm.firearmId, firearmId))
    .limit(1);
  if (linked) {
    throw new ValidationError(["magazineFedHasCompatibleMagazines"]);
  }
}
```

The absence of a visibility filter is **deliberate**—the guard is a data-integrity check, not a permission check. See [Validation Rules](#validation-rules) for the rationale.

### Form handling

`FirearmFormValues` includes `isMagazineFed: boolean` [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). The `EMPTY` constant defaults it to `true`. The form's `firstMessage` plumbing surfaces the `magazineFedHasCompatibleMagazines` error code on the checkbox via `magFedError`.

```ts
const magFedError = firstMessage(codes, [
  "magazineFedHasCompatibleMagazines",
]);
```

### Rendering helper

`magazineCountValue(isMagazineFed, count)` in `app/(app)/firearms/magazine-count.tsx` is the single source of truth for how a magazine count renders. All three surfaces import and call it [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). When adding a new surface that displays a magazine count, import this helper rather than re-implementing the branch.

### Filtering helper

`magazineFedOptions(firearms)` in `app/(app)/magazines/firearm-options.ts` filters a list of firearms to only those where `isMagazineFed` is true [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). Call it anywhere you need a list of firearms that a magazine may be declared compatible with. Do **not** also filter `nameById`—see [The `nameById` asymmetry](#the-namebyid-asymmetry).

### Summary domain

`FirearmIdentity` in `src/domain/summary/summary.ts` carries an optional `isMagazineFed?: boolean` (absent means `true` for backward compatibility). `FirearmCount` carries a required `isMagazineFed: boolean`, populated by `computeSummary` as `f.isMagazineFed ?? true` [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108). If you add a new aggregate over firearms, follow this same pattern.

### Key files

| File | Role |
|------|------|
| `src/db/inventory-schema.ts` | Schema declaration |
| `src/db/migrations/0023_crazy_spirit.sql` | Migration |
| `src/domain/firearms/service.ts` | `createFirearm`, `updateFirearm`, `assertNoCompatibleMagazines` |
| `src/domain/validation-messages.ts` | `magazineFedHasCompatibleMagazines` message |
| `app/(app)/firearms/firearm-form.tsx` | `FirearmFormValues`, `EMPTY`, checkbox, error wiring |
| `app/(app)/firearms/magazine-count.tsx` | `magazineCountValue` shared helper |
| `app/(app)/firearms/firearms-view.tsx` | Firearms table `# Mags` cell renderer |
| `app/(app)/firearms/firearm-detail-view.tsx` | Detail view "Compatible magazines" row |
| `app/(app)/magazines/firearm-options.ts` | `magazineFedOptions` |
| `app/(app)/magazines/page.tsx` | Magazine list page (hasFirearms, nameById, firearmOptions) |
| `app/(app)/magazines/[id]/page.tsx` | Magazine edit page (nameById, firearmOptions) |
| `app/(app)/magazines/magazines-view.tsx` | `hasFirearms` prop, empty state gate |
| `app/(app)/summary/summary-tables.tsx` | Summary "Compatible mags" cell renderer |
| `src/domain/summary/summary.ts` | `FirearmCount.isMagazineFed`, `computeSummary` |

## Testing Scenarios

### Unit and integration tests (`src/domain/firearms/__tests__/service.test.ts`)

The following scenarios are covered in the `"firearms service — magazine-fed flag (#37)"` describe block [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

| Scenario | Expected result |
|----------|----------------|
| Create a firearm without specifying the flag | `isMagazineFed` is `true` (default) |
| Create a firearm with `isMagazineFed: false` | `isMagazineFed` is `false` |
| Update a firearm to `isMagazineFed: false` when nothing is linked | Succeeds |
| Update to `false` while the actor's own magazine is linked | Throws `ValidationError` with code `magazineFedHasCompatibleMagazines`; the entire transaction rolls back (scalar changes in the same call also revert) |
| Update to `false` while a **different owner's** magazine is linked | Also throws `ValidationError` — cross-owner protection fires |
| Unrelated edit (rename) while still magazine-fed and linked | No guard fires; succeeds |
| Toggle the flag back to `true` | Always succeeds |

**Transaction rollback test:** The service test deliberately submits a rename *and* `isMagazineFed: false` in the same call when a magazine is linked. After the rejection, it reads the row directly from the database and asserts that the name is still the original value—proving the scalar edit did not persist [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

**Cross-owner test:** userB is granted view permission on userA's firearm and links userB's own magazine to it. userA then tries to set `isMagazineFed: false`. The guard fires even though userA cannot see userB's magazine [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Option filtering tests (`app/(app)/magazines/__tests__/firearm-options.test.ts`)

| Scenario | Expected result |
|----------|----------------|
| Mixed list of magazine-fed and non-magazine-fed | Only magazine-fed firearms appear in options |
| All firearms non-magazine-fed | Returns empty array |
| Duplicate names among selectable firearms | Hint (short ID fragment) added to both |
| Duplicate name where one is non-selectable (non-magazine-fed) | No hint added — not a collision among selectable items |
| `nameById` built from unfiltered list | Non-magazine-fed firearm's name still resolves via `nameById` even though it's excluded from options |

### End-to-end tests (`e2e/firearm-magazine-fed.spec.ts`)

The Playwright spec covers the full user-facing flow [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

1. **Default checkbox state:** the "This firearm uses detachable magazines" checkbox is checked when the add-firearm form first opens.
2. **Create non-magazine-fed:** uncheck the box, add a Stevens 311 (break-action shotgun) — the `# Mags` cell in the firearms table shows `—`, not `0`.
3. **Create magazine-fed with no magazines:** add a Glock 19 without unchecking — the `# Mags` cell shows `0`.
4. **Filtering in the magazine form:** open the magazine add form; the Glock 19 appears in the "Compatible firearms" group; the Stevens 311 does not.
5. **Guard fires on edit:** link a magazine to the Glock 19, then try to uncheck the box on the Glock's edit form and save. The error message appears inline, the checkbox shows `aria-invalid="true"`, and no success toast appears.
6. **Rejection does not persist:** reloading the edit form shows the checkbox still checked.
7. **Unlink then toggle:** remove the magazine's Glock 19 compatibility, then uncheck the Glock's box and save. Succeeds.

## Migration and Backfill

### Migration file

**`src/db/migrations/0023_crazy_spirit.sql`** [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108):

```sql
ALTER TABLE "firearm" ADD COLUMN "is_magazine_fed" boolean DEFAULT true NOT NULL;
```

This is the entire migration—a single `ALTER TABLE` statement with no separate `UPDATE` or data-migration script.

### How the backfill works

PostgreSQL applies the `DEFAULT true` clause immediately when the column is added, setting every existing row to `true`. All pre-existing firearms are therefore treated as magazine-fed. This preserves the historical behavior exactly: before this migration, all firearms were implicitly magazine-fed; after it, they are explicitly magazine-fed via the new column [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Backup and restore

**Restoring a backup taken before this migration** works without any intervention. When Drizzle or the app inserts firearms from a backup that omits the `is_magazine_fed` column, PostgreSQL applies `DEFAULT true` to those rows. The result is the same as running the migration fresh: all restored firearms are magazine-fed [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

The backup/export pipeline (`src/backup/db-export.ts`) uses `db.select().from(table)` and `src/backup/table-order.ts` already includes `firearm`, so the new column is included in fresh exports automatically.

### No drift

The migration was generated by `bun run db:generate` from the Drizzle schema change. The generated SQL was verified to contain only the single `ALTER TABLE` statement with no unrelated drift.

## Edge Cases and Considerations

### Direct database edits

The validation guard only fires through the application's service layer. If someone directly edits the database to set `is_magazine_fed = false` on a firearm that already has `magazine_firearm` rows, the application handles it gracefully:

- The `# Mags` cell and detail view show `—` (because rendering is keyed off the flag).
- The `nameById` map is built from the unfiltered firearm list, so the magazine's compatible-firearm badge still renders the firearm's name [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).
- The app prevents *creating* new such inconsistencies through normal use—the guard blocks the transition.

The inconsistency is visible (the magazine shows a compatibility it shouldn't have), but it does not cause errors or data loss.

### Sorting non-magazine-fed firearms by magazine count

Non-magazine-fed firearms sort as `0` on the `# Mags` column, because sorting is based on the underlying `magazineCount` value rather than the rendered cell. This is an accepted tradeoff—adding a separate sort key is not worth the complexity for a display-only distinction [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Magazine filter dropdown

Non-magazine-fed firearms never appear in the "compatible firearm" filter dropdown on the magazines list page. Because the validation guard prevents a non-magazine-fed firearm from ever having compatibility rows through the app, this filter option would always yield zero results—so omitting it is correct [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Pre-#37 call sites and test literals

`FirearmIdentity.isMagazineFed` is declared optional (`isMagazineFed?: boolean`) so that call sites and test literals that pass only `{id, name}` continue to compile. Absent means magazine-fed, matching both the column default and every row that predates the flag [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

### Turning the flag off and then on again

There is no guard on setting `isMagazineFed: true`. Once a firearm has been successfully marked non-magazine-fed (meaning all its compatibility rows were first removed), it can be toggled back to magazine-fed at any time without restriction [[1]](https://github.com/unclesp1d3r/mag_stacker/pull/108).

## Related Documentation

- **[A viewer-relative read feeding a replace-all write silently destroys hidden rows](https://github.com/unclesp1d3r/mag_stacker/blob/4a85247643ef6202d8a93dada47451b2cffad4f1/docs/solutions/logic-errors/a-viewer-relative-read-feeding-a-replace-all-write-destroys-hidden-rows.md)** (`docs/solutions/logic-errors/a-viewer-relative-read-feeding-a-replace-all-write-destroys-hidden-rows.md`) — explains the class of data-loss bug that motivates the block-not-detach design decision. Required reading to understand why the guard is cross-owner and why detach-on-toggle was rejected.

- **[`src/domain/compatibility/relation.ts`](https://github.com/unclesp1d3r/mag_stacker/blob/4a85247643ef6202d8a93dada47451b2cffad4f1/src/domain/compatibility/relation.ts)** — the shared viewer-relative compatibility implementation for both magazines and accessories. `replaceCompatibility` and `loadCompatibility` are the authoritative API; `loadStoredRows` is intentionally internal.

- **`docs/plans/2026-08-08-001-feat-non-magazine-fed-firearm-plan.md`** — the full implementation plan for this feature, including the complete requirements list (R1–R11), key technical decisions (KTD1–KTD7), and implementation units. Consult this document for the rationale behind decisions not fully explained here.

- **[PR #108: feat(firearms): mark a firearm as not magazine-fed](https://github.com/unclesp1d3r/mag_stacker/pull/108)** — the pull request that introduced this feature. The PR description contains the full "block, don't detach" rationale and the test coverage summary.

- **Issue #37** — the originating issue: *"Mark a firearm as not magazine-fed (exclude from magazine creation, blank the # Mags column)"*. Closed by PR #108.
