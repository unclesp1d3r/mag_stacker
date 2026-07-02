> **Carried over from the original Avalonia/.NET MagStacker project.** This decision predates the Next.js/Bun re-platform but **still holds** here: the `magazine_firearm.ordinal` column lives in `src/db/inventory-schema.ts` and orders the compatible-firearms output (including CSV export). Historical references below (e.g. `docs/ergonomics-verdict.md`, `../MagStacker`) point at the original project and are not part of this repository.



# ADR-0004: Ordinal column on the magazine↔firearm join for deterministic link order

**Date**: 2026-06-20
**Status**: accepted
**Deciders**: UncleSp1d3r (owner)

## Context

The CSV export's "Compatible Firearms" column must list firearm names "in stored ID order" (parity
§9.3) — the order the user supplied when linking. The shipped `magazine_firearm` join table
(ADR-0001's many-to-many) carries only a composite primary key `(MagazineId, FirearmId)` and no
ordering column, so the order rows come back in is undefined and not guaranteed stable across SQLite
versions or query plans. The CSV output would therefore be non-deterministic, and a round-trip
(link `[A, B, C]`, export) could reorder the names.

## Decision

Add an `Ordinal` integer column to the `MagazineFirearm` join entity capturing each link's insertion
position within a magazine's link set. The repository assigns `Ordinal` by position on link replace and
orders link reads by it when populating `Magazine.CompatibleFirearmIds`. A small EF migration extends
the already-shipped join table; the existing `Database.Migrate()` startup path applies it.

## Alternatives Considered

### Alternative 1: Fixed deterministic sort (e.g. by firearm name or ID) at read/export time
- **Pros**: no schema change, no migration.
- **Cons**: deterministic but **not** parity-true — it discards the user-supplied order and would sort
  `[C, A, B]` into `[A, B, C]`, diverging from the Go app's stored-order behavior.
- **Why not**: the requirement is the *user's* order, not an alphabetical one.

### Alternative 2: Rely on insertion (rowid) order with no explicit ordering
- **Pros**: zero work.
- **Cons**: rowid/insertion order is an implementation detail, undefined by the SQL standard and not
  guaranteed by EF Core's query translation; effectively the non-deterministic status quo.
- **Why not**: leaves the exact bug the requirement flags unresolved.

## Consequences

### Positive
- CSV "Compatible Firearms" order is deterministic and preserves the order the user linked firearms in
  (parity-true).
- The ordinal is a first-class, queryable signal usable by any future feature needing link order.

### Negative
- A schema migration on an already-shipped table; pre-existing rows backfill to `Ordinal = 0`
  (acceptable at this dev stage with no production data).
- Link writes now carry the small extra responsibility of assigning ordinals positionally.

### Risks
- A link write path that forgets to set `Ordinal` would silently collapse order to 0. *Mitigation*:
  ordinal assignment lives in the single repository link-replace path and is covered by a
  read-back-order test (plan unit U3).

## Related

- Plan: `docs/plans/2026-06-20-002-feat-remaining-port-features-plan.md` (KTD4, unit U3)
- Builds on: `docs/adr/0001-posture-b-mutable-entities.md`, `docs/plans/2026-06-20-001-feat-magazine-firearm-many-to-many-plan.md`
- Behavioral contract: `docs/reference/go-parity-spec.md` §9.3
