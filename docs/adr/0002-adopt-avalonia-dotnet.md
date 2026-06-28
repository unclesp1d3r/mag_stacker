> **Vendored snapshot — not this project's source.** Read-only copy from the Avalonia/.NET MagStacker project, kept here so the web re-platform requirements stay self-contained. Any relative links below (e.g. `docs/plans/…`, `docs/ergonomics-verdict.md`, `../MagStacker`) refer to that original project and are **not** part of this repository.



# ADR-0002: Adopt Avalonia/.NET over Go + Wails for desktop clients

**Date**: 2026-06-18
**Status**: accepted
**Deciders**: UncleSp1d3r (owner)

## Context

The maintained MagStacker is a Go + Wails desktop app (sibling repo `../MagStacker`). To evaluate
whether Avalonia/.NET is a better stack for future desktop clients in 2026, a vertical slice — the
Firearms list + add/edit form — was built end-to-end on the idiomatic .NET stack (Domain → Data →
Service → UI), mirroring the Go app's layered shape. The slice returned a **GO** verdict: the
architecture mapped cleanly, the build/test loop was fast, compiled bindings caught binding errors at
compile time, and the EF Core + SQLite + migrations story was solid. The owner judged the experience
"remarkably low pain" and decided to port the rest of MagStacker to .NET rather than treat the slice
as a throwaway learning track.

## Decision

Adopt **Avalonia 12 + .NET 10** as the desktop stack for MagStacker — CommunityToolkit.Mvvm
(source-generated MVVM), compiled bindings (`x:DataType`), .NET Generic Host for DI, and EF Core +
SQLite (local file, no networked data access). Port beyond the evaluation slice toward a full
reimplementation; the Go + Wails app stays canonical until the port reaches parity.

## Alternatives Considered

### Alternative 1: Stay on Go + Wails (status quo)
- **Pros**: maintained and working today; team familiarity; web-tech UI layer.
- **Cons**: the evaluation specifically set out to assess a more strongly-typed, compile-time-checked
  desktop stack with first-class data tooling.
- **Why not**: the slice found Avalonia/.NET low-friction with material wins (build-time binding
  verification, sub-second dev loop, idiomatic EF Core data story); the owner chose to adopt.

### Alternative 2: Adopt .NET but with a different UI framework (MAUI / WPF / Uno)
- **Pros**: other mature .NET UI options exist.
- **Cons**: WPF is Windows-only; MAUI/Uno carry different trade-offs and were **not** evaluated in
  this slice.
- **Why not**: Avalonia was chosen for cross-platform support on macOS plus idiomatic MVVM; a
  head-to-head against other .NET UI frameworks was out of scope for the evaluation.

## Consequences

### Positive
- Compile-time guarantees: `x:CompileBindings` turns binding-path mistakes into build errors.
- Fast inner loop: sub-second incremental builds; the slice's 36-test suite runs in under a second.
- Solid data story: EF Core entity configuration, migrations, and local-file SQLite all worked
  cleanly; layered architecture maps onto the Go app's shape for an apples-to-apples comparison.

### Negative
- Two stacks coexist during the transition; the Go + Wails app remains the canonical product until
  the .NET port reaches parity.
- The team takes on .NET/Avalonia ramp-up; some framework version churn observed (the template
  resolved to Avalonia 12, not 11; one deprecated API).

### Risks
- The hardest features (Magazines + many-to-many, Summary view) are not yet built on .NET.
  *Mitigation*: the deferred Go behavior is captured durably in `docs/reference/go-parity-spec.md`,
  and the two open verdict conditions are being resolved first (Posture B — see
  [ADR-0001](0001-posture-b-mutable-entities.md); plus a pending IDE/hot-reload evaluation pass).
- The IDE + hot-reload axes were not exercised in the CLI-built slice. *Mitigation*: a hands-on pass
  on Rider and VS Code + C# Dev Kit is scheduled before Magazines (foundations plan, unit U5).

## Related

- Verdict: `docs/ergonomics-verdict.md`
- Behavioral parity reference: `docs/reference/go-parity-spec.md`
- Foundations requirements: `docs/brainstorms/2026-06-18-dotnet-port-foundations-requirements.md`
- Supersedes nothing; superseded by nothing.
