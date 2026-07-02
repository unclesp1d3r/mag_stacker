# ADR-0008: Store `magpulMode` as a Better Auth `additionalFields` flag on `user`

**Date**: 2026-07-01
**Status**: accepted
**Deciders**: unclesp1d3r (with Claude Code)

## Context

The opt-in Magpul mode (ADR-0007, issue #21) needs a per-account boolean. The app had **no user-preferences store**, and the `user` table is Better Auth-managed — the admin plugin already added custom columns (`role`, `banned`, …). This is the app's first per-account profile setting.

## Decision

Store `magpulMode` as a Better Auth `additionalFields` boolean on `user` (default `false`, `input: false`), generated via the Better Auth CLI (`magpul_mode`) and surfaced on `SessionUser`. The settings toggle writes it with a scoped Drizzle update, because `input: false` blocks the client-facing `updateUser` path.

## Alternatives Considered

### Alternative 1: Separate owner-scoped `user_settings` table
- **Pros**: clean separation; scales cleanly to many preferences.
- **Cons**: a join and an entire table for one boolean; extra migration + maintenance surface.
- **Why not**: YAGNI for a single flag. Revisit when a second per-account setting appears.

### Alternative 2: Client-writable additionalField (`input: true`)
- **Pros**: the toggle could use Better Auth's `updateUser` directly, no Drizzle special-case.
- **Cons**: exposes the flag to any client through a generic profile-update endpoint.
- **Why not**: keep the server the sole writer; the settings action writes via a scoped Drizzle update instead.

## Consequences

### Positive
- Rides the session for the common self-edit path — no extra query to know the acting user's mode.
- Reuses the proven admin-plugin `additionalFields` pattern; a one-column migration.

### Negative
- `additionalFields` are dynamically typed on the session, so `getCurrentUser` reads them via an explicitly-optional raw type and defaults to `false` (avoiding an unsound cast).
- The settings write bypasses `updateUser` (uses Drizzle) — a small, documented special case in the server action.

### Risks
- Accreting more booleans on `user` would erode cohesion; when a second per-account setting arrives, reconsider a dedicated settings table (noted for revisit).
