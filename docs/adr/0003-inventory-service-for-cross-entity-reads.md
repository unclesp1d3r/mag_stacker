> **Vendored snapshot — not this project's source.** Read-only copy from the Avalonia/.NET MagStacker project, kept here so the web re-platform requirements stay self-contained. Any relative links below (e.g. `docs/plans/…`, `docs/ergonomics-verdict.md`, `../MagStacker`) refer to that original project and are **not** part of this repository.



# ADR-0003: Dedicated InventoryService for cross-entity reads

**Date**: 2026-06-20
**Status**: accepted
**Deciders**: UncleSp1d3r (owner)

## Context

Three of the remaining ported features read **both** firearms and magazines: the Summary roll-up
(per-firearm counts plus per-caliber totals), CSV export (resolves compatible-firearm IDs to names),
and `DistinctCalibers` (union of calibers across both tables). The shipped service layer follows a
one-service-per-aggregate boundary — `MagazineService` is constructed with only `IMagazineRepository`,
`FirearmService` with only `IFirearmRepository`. There is no home for a read that spans both
aggregates without either crossing that boundary or pushing orchestration into the UI.

## Decision

Introduce `IInventoryService` (`InventorySummaryAsync`, `ExportCsvAsync`, `DistinctCalibersAsync`)
constructed with both `IMagazineRepository` and `IFirearmRepository`. `MagazineService` keeps magazine
CRUD plus the new filter and bulk-add; `FirearmService` is untouched.

## Alternatives Considered

### Alternative 1: Widen `MagazineService` to also take `IFirearmRepository`
- **Pros**: no new type; one fewer DI registration.
- **Cons**: gives the magazine service a firearm dependency it does not need for CRUD/filter/bulk-add;
  blurs the one-service-per-aggregate boundary and grows the constructor for unrelated reasons.
- **Why not**: cross-entity reads are a distinct concern; bolting them onto the magazine aggregate
  couples unrelated responsibilities.

### Alternative 2: Compose both repositories/services in the Summary ViewModel
- **Pros**: no new service type.
- **Cons**: moves application-layer orchestration (snapshot assembly, summary/CSV composition) into the
  UI, where it is harder to unit-test and diverges from the established service-as-boundary pattern.
- **Why not**: the UI should call one boundary method, not assemble inventory snapshots itself.

## Consequences

### Positive
- Each service keeps a minimal, intention-revealing dependency set; the cross-entity concern has a
  single named home.
- `InventoryService` is unit-testable with the existing hand-written repository fakes.
- The UI calls one boundary method per feature (`InventorySummaryAsync`, `ExportCsvAsync`).

### Negative
- One more service type and DI registration.
- `DistinctCalibers` ownership lands on the inventory service even though a caller might intuit it as a
  magazine concern; mitigated by the union-of-both-tables semantics, which is inherently cross-entity.

### Risks
- Future cross-entity reads might accrete here into a grab-bag. *Mitigation*: keep `InventoryService`
  scoped to whole-inventory reads (summary, export, distinct calibers); aggregate-specific operations
  stay on their aggregate's service.

## Related

- Plan: `docs/plans/2026-06-20-002-feat-remaining-port-features-plan.md` (KTD2, units U5)
- Origin: `docs/brainstorms/2026-06-20-remaining-features-requirements.md` (R1, R3, R11)
- Behavioral contract: `docs/reference/go-parity-spec.md` §6, §7
