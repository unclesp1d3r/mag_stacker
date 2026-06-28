> **Vendored snapshot — not this project's source.** Read-only copy from the Avalonia/.NET MagStacker project, kept here so the web re-platform requirements stay self-contained. Any relative links below (e.g. `docs/plans/…`, `docs/ergonomics-verdict.md`, `../MagStacker`) refer to that original project and are **not** part of this repository.



# Architecture Decision Records

Architectural decisions for MagStacker.NET, captured as they happen. See `template.md` for the format.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-posture-b-mutable-entities.md) | Posture B — persisted entities are mutable classes, everything else immutable | accepted | 2026-06-18 |
| [0002](0002-adopt-avalonia-dotnet.md) | Adopt Avalonia/.NET over Go + Wails for desktop clients | accepted | 2026-06-18 |
| [0003](0003-inventory-service-for-cross-entity-reads.md) | Dedicated InventoryService for cross-entity reads | accepted | 2026-06-20 |
| [0004](0004-join-ordinal-for-deterministic-csv-order.md) | Ordinal column on the magazine↔firearm join for deterministic link order | accepted | 2026-06-20 |
| [0005](0005-per-platform-best-effort-file-permissions.md) | Per-platform best-effort owner-only permissions for the exported CSV | accepted | 2026-06-20 |
| [0006](0006-export-csv-returns-string-ui-writes-file.md) | ExportCSV returns a string; the UI layer owns the file write | accepted | 2026-06-20 |
