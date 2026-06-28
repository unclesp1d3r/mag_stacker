> **Vendored snapshot — not this project's source.** Read-only copy from the Avalonia/.NET MagStacker project, kept here so the web re-platform requirements stay self-contained. Any relative links below (e.g. `docs/plans/…`, `docs/ergonomics-verdict.md`, `../MagStacker`) refer to that original project and are **not** part of this repository.



# ADR-0006: ExportCSV returns a string; the UI layer owns the file write

**Date**: 2026-06-20
**Status**: accepted
**Deciders**: UncleSp1d3r (owner)

## Context

CSV export has two parts: serialize the inventory's magazines to an RFC-4180 string (with the
formula-injection guard and the deterministic compatible-firearms order), and write that string to a
user-chosen file via the native save dialog with per-platform permissions. The serialization is pure
and belongs in the layered stack; the dialog, the file write, and the platform ACL/mode handling are
inherently UI/host concerns. The question is where the seam between "produce the bytes" and "write the
file" sits.

## Decision

`IInventoryService.ExportCsvAsync` returns the CSV **string** (built by a pure-domain `CsvExporter`).
The UI layer owns everything downstream: the Summary ViewModel calls the service for the string, then
the `IDialogService` save dialog supplies a path, then a small UI file-writer applies the platform
permissions (ADR-0005) and writes the bytes. The service performs no file I/O.

## Alternatives Considered

### Alternative 1: Service takes a path and writes the file itself
- **Pros**: one call from the UI; export "done" in the service.
- **Cons**: pushes file I/O, the save-dialog dependency, and platform ACL/mode code down into the
  service layer, which otherwise has no I/O and no UI dependency; harder to unit-test without touching
  the filesystem.
- **Why not**: violates the layer boundary — the service would need to know about dialogs and OS
  permission APIs.

### Alternative 2: ViewModel builds the CSV inline (no service method)
- **Pros**: fewer moving parts.
- **Cons**: duplicates serialization knowledge in the UI and bypasses the service-as-boundary pattern;
  the pure exporter could not be exercised through the application boundary.
- **Why not**: serialization is application/domain logic, not view logic.

## Consequences

### Positive
- The service stays free of file I/O and platform code, mirroring the Go service/shell split, and is
  unit-testable by asserting the returned string.
- Serialization lives once in a pure-domain `CsvExporter` covered by exhaustive acceptance-example
  tests; the file-writer is independently testable against a temp directory.
- Cancellation (null dialog path) is a clean UI-layer no-op; write failures surface as UI errors
  without the service knowing about them.

### Negative
- Export is a two-step UI flow (get string, then write) rather than one service call.
- The CSV string is held in memory before writing; negligible for realistic inventory sizes.

### Risks
- A future caller might re-implement the write instead of reusing the file-writer helper.
  *Mitigation*: the single `ShowSaveFileDialogAsync` + file-writer path is the one documented seam
  (plan unit U8).

## Related

- Plan: `docs/plans/2026-06-20-002-feat-remaining-port-features-plan.md` (KTD3, units U5 and U8)
- Related: `docs/adr/0005-per-platform-best-effort-file-permissions.md`
- Behavioral contract: `docs/reference/go-parity-spec.md` §6, §9
