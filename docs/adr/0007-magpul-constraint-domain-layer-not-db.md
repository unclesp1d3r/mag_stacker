# ADR-0007: Enforce the Magpul label constraint in the domain/UX layer, not the database

**Date**: 2026-07-01
**Status**: accepted
**Deciders**: unclesp1d3r (with Claude Code)

## Context

Issue #21 asked to constrain `magazine.label` to the PMAG Gen M3 dot-matrix set (`A-Z`, `0-9`, `-`, max 4) and *originally proposed a global rule with a database `check` backstop*. During brainstorm/planning this was reworked into an **opt-in, per-account "Magpul mode"**: the constraint applies only when the magazine **owner's** mode is on, must **grandfather** existing nonconforming labels, is owner-governed under grant-based sharing, and must hold on every write path (single add/edit, bulk add, server actions, paste).

## Decision

Enforce the constraint in the domain/service layer (authoritative) plus a client form input mask (affordance only). No database `CHECK` constraint or trigger. The owner's mode is resolved server-side inside the write transaction and passed to a **pure** validator; labels are normalized (uppercase + outer-trim) and stored only when the owner's mode is on; invalid input is rejected, never truncated.

## Alternatives Considered

### Alternative 1: Table-level `CHECK` constraint (the original #21 proposal)
- **Pros**: DB-guaranteed invariant; cannot be bypassed by any write path.
- **Cons**: cannot read the owner's per-account flag or express "only when mode on"; cannot grandfather existing rows.
- **Why not**: the rule is conditional on another table's column — structurally inexpressible as a `CHECK`.

### Alternative 2: `BEFORE INSERT/UPDATE` trigger
- **Pros**: DB-enforced; could join the `user` row to read the flag.
- **Cons**: cross-table coupling and operational complexity in the storage layer for what is a UX/validation rule; duplicates domain logic in SQL.
- **Why not**: the coupling and complexity aren't justified for a validation feature that isn't a storage invariant.

### Alternative 3: Global constraint on every label
- **Pros**: one code path; simplest rule.
- **Cons**: punishes owners who mark magazines with arbitrary stencilled/painted identifiers and never opted into the dot-matrix workflow.
- **Why not**: the constraint is only meaningful for owners who opt in.

### Alternative 4: Per-magazine "marking type" flag (vs per-account)
- **Pros**: mixed marking schemes within one account.
- **Cons**: more state, no demonstrated need.
- **Why not**: YAGNI; a per-account opt-in signals intent for hard enforcement. Revisit if mixed per-magazine marking becomes a real need.

## Consequences

### Positive
- Supports conditional / owner-governed / grandfathering behavior that a DB constraint cannot express.
- The pure validator is trivially unit-tested; owner resolution + normalization live in the service and are integration-tested.
- Shared constants (`MAX_LABEL_LENGTH`, allowed-set regex, `normalizeMagpulLabel`) back single add, bulk add, and the form, and are reused by #20 (rendering) and #22 (auto-numbering).

### Negative
- No DB backstop: a future write path that bypasses the domain service could persist a nonconforming label. Mitigation: all writes route through the service; bulk add was explicitly wired in.
- The client mask keys on the owner's flag only for self-owned magazines; shared-magazine edits by a grantee defer to authoritative domain validation (no client mask).

### Risks
- The per-write owner-mode lookup adds a read — bounded (indexed primary-key lookup) and inside the existing transaction. The update path locks the row (`SELECT … FOR UPDATE`) so a stale read can't skip normalization/validation under concurrent shared edits.
