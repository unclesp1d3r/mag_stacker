# ADR-0010: Defer the TypeScript 6.0 upgrade; stay on 5.9.x until the Bun type stack resolves under TS 6

**Date**: 2026-07-04
**Status**: accepted
**Deciders**: unclesp1d3r (with Claude Code)

## Context

Dependabot PR #5 bumps `typescript` `^5.9.3` → `^6.0.3` (a major, released 2026-03-23). Under 6.0, `bun run typecheck` (`tsc --noEmit`) fails with `Cannot find module 'bun:test'` across ~30 test files, plus downstream implicit-`any` errors in `src/domain/bulkadd/__tests__/labels.test.ts`. `main` on TS 5.9.3 typechecks clean.

Root cause is a deliberate TS 6.0 change: `compilerOptions.types` now defaults to `[]` instead of auto-discovering every `@types/*` package. Our `tsconfig.json` sets no `types` field, so `@types/bun` — which declares the `bun:test` ambient module — is no longer loaded. The implicit-`any` errors are a *consequence* of the failed import (the harness symbols degrade to `any`), not a second issue. Per [Bun's TS 6/7 doc](https://bun.com/docs/typescript-6), the nominal fix is `"types": ["bun"]`.

## Decision

Stay on TypeScript **5.9.x** for now. Do **not** merge #5; keep it open as a tracking reminder (commented with the breakage details). Revisit the 6.0 upgrade when the Bun type packages resolve cleanly under TS 6, or when we plan the eventual move to TS 7.

## Alternatives Considered

### Alternative 1: Migrate to TS 6.0 now (`types` array + `ts5to6`)
- **Pros**: current with the toolchain; a head start on the TS 7 (native Go compiler) transition; `npx @andrewbranch/ts5to6` automates the mechanical config parts.
- **Cons**: `types` is an allowlist — setting `["bun"]` also stops auto-loading `@types/node`, so it must be reconstructed as `["bun", "node"]` for this Next.js + Node + React project and re-verified against 6.0's ~9 changed defaults. More seriously, this repo's tree has both `@types/bun` and (transitively) `bun-types`, which triggers the still-open [oven-sh/bun#30503](https://github.com/oven-sh/bun/issues/30503): the `Bun` global resolves to empty under TS 6 *even with* `types: ["bun"]`, pending an upstream `bun-types` structural fix.
- **Why not**: a real migration gated on an unfixed upstream bug, for little upside on an explicitly transitional major release.

### Alternative 2: Close PR #5 outright
- **Pros**: removes a red/open PR from the queue.
- **Cons**: loses the visible reminder; Dependabot re-opens the bump on the next 6.0.x release anyway.
- **Why not**: keeping it open (with an explanatory comment) documents the deferral where the next maintainer will look.

### Alternative 3: `"ignoreDeprecations": "6.0"` escape hatch
- **Pros**: standard TS 6.0 mechanism to suppress deprecated-option errors and buy time.
- **Cons**: the `bun:test` failure is a `types`-discovery change, **not** a deprecation — this flag does nothing for it; TS 7.0 removes the flag entirely.
- **Why not**: doesn't address the actual root cause.

## Consequences

### Positive
- `main` and CI stay green on the proven TS 5.9.3 toolchain; no day-one-of-a-major churn.
- No dependence on the unresolved `bun-types` / TS 6 resolution bug.
- The decision and its trigger conditions are recorded, so the next attempt starts from evidence rather than rediscovery.

### Negative
- The project trails the latest TypeScript; migration debt accrues quietly until TS 7 forces the issue.
- PR #5 lingers open and red until revisited.

### Risks
- Deferral drifts indefinitely and collides with the TS 7 cutover. **Mitigation**: revisit when `@types/bun`/`bun-types` ship a TS 6-clean release (watch oven-sh/bun#30503), or proactively as part of TS 7 planning — whichever comes first.
