> **Vendored snapshot — not this project's source.** Read-only copy from the Avalonia/.NET MagStacker project, kept here so the web re-platform requirements stay self-contained. Any relative links below (e.g. `docs/plans/…`, `docs/ergonomics-verdict.md`, `../MagStacker`) refer to that original project and are **not** part of this repository.



# ADR-0001: Posture B — persisted entities are mutable classes, everything else immutable

**Date**: 2026-06-18
**Status**: accepted
**Deciders**: UncleSp1d3r (owner)

## Context

The Firearms vertical slice (the Avalonia/.NET ergonomics evaluation) shipped with a strictly
immutable `record` domain model, following the global "immutability is CRITICAL" rule. That choice
fought EF Core change-tracking and two-way MVVM binding: each persisted entity paid a recurring tax —
`context.Update(detached)` plus a `DbUpdateConcurrencyException`→not-found translation on the
persistence side, and a hand-written mutable edit-ViewModel mapping layer on the binding side
(`[ObservableProperty]` cannot target init-only record properties). The GO verdict made "decide the
domain-immutability posture deliberately" a condition. Magazines is the worst case for the immutable
path: a larger edit surface plus a many-to-many where EF relationship fixup wants mutable navigation
collections.

## Decision

Persisted EF aggregate roots (`Firearm`, `Magazine`, …) are **mutable classes** with EF-tracked
navigation collections. Value objects, DTOs, validation results, and transform logic stay **immutable
records**. Governing rule: *identity + lifecycle → `class`; value-like → `record`*. Mutation is
confined to the EF unit of work (load → mutate → save).

## Alternatives Considered

### Alternative 1: Posture A — keep everything immutable (records all the way)
- **Pros**: maximal immutability; aligns with the global always-immutable rule; no aliased-shared-state risk.
- **Cons**: per-entity tax — edit-VM mapping ceremony, `context.Update(detached)` +
  concurrency-exception translation, and friction with EF relationship fixup.
- **Why not**: the tax compounds with the coming Magazines many-to-many; the friction is the cost of
  forcing immutability into a change-tracking ORM and a two-way-binding UI framework.

### Alternative 2: Blanket-mutable — drop immutability everywhere
- **Pros**: simplest possible fit for EF Core and MVVM.
- **Cons**: discards immutability where it is cheap and valuable — value objects, DTOs, validation
  results, transforms.
- **Why not**: throws away real safety for no benefit; the friction was only ever at the
  persisted-entity boundary.

## Consequences

### Positive
- One consistent entity pattern across the codebase; matches the project's own C# convention
  (`class` for identity + lifecycle, `record` for value-like models).
- Update path simplifies to load-then-mutate; not-found becomes a clean null check on load.
- Natural EF relationship fixup for the deferred Magazines many-to-many (the payoff that motivated B).

### Negative
- A documented carve-out from the global "immutability is CRITICAL" rule, scoped to persisted
  entities only — value objects/DTOs stay immutable.
- Mutation is permitted (confined to the EF unit of work) where the global rule otherwise forbids it.

### Risks
- A future contributor or agent "fixes" entities back to records. *Mitigation*: the carve-out is
  documented in `AGENTS.md` (foundations plan, unit U4).
- A tracked entity accidentally bound to the edit dialog breaks cancel-safety. *Mitigation*: the
  working-copy ViewModel pattern, locked in by a regression test (foundations plan, unit U3).

## Related

- Origin: `docs/brainstorms/2026-06-18-dotnet-port-foundations-requirements.md` (decision D1)
- Implementing plan: `docs/plans/2026-06-18-002-refactor-dotnet-port-foundations-plan.md`
- Verdict: `docs/ergonomics-verdict.md`
