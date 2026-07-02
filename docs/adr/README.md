# Architecture Decision Records

Architectural decisions for MagStacker (the Next.js/Bun web app), captured as they happen. See `template.md` for the format.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0004](0004-join-ordinal-for-deterministic-csv-order.md) | Ordinal column on the magazine↔firearm join for deterministic link order | accepted | 2026-06-20 |
| [0007](0007-magpul-constraint-domain-layer-not-db.md) | Enforce the Magpul label constraint in the domain/UX layer, not the database | accepted | 2026-07-01 |
| [0008](0008-magpul-mode-better-auth-additional-field.md) | Store `magpulMode` as a Better Auth `additionalFields` flag on `user` | accepted | 2026-07-01 |
| [0009](0009-org-plugin-hybrid-sharing.md) | Better Auth organization plugin for onboarding/branding; hybrid sharing over per-item grants | accepted | 2026-07-01 |

> **Note on numbering.** ADRs 0001–0003, 0005, and 0006 were a vendored, read-only snapshot of decisions from the original Avalonia/.NET MagStacker project. They were removed during the web re-platform because they described .NET/EF/MVVM or desktop constructs that don't exist here. **0004** is retained — its decision (the join `ordinal` column) still holds in the web schema. Numbers are permanent identifiers, so the gaps are intentional; new ADRs continue from the highest number.
