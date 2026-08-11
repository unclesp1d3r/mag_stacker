# ADR-0011: Pin Next.js to 16.2.11 until Bun stable ships the napi teardown fix

**Date**: 2026-08-10
**Status**: accepted
**Deciders**: unclesp1d3r (with Claude Code)

## Context

PR #108 carried a `next` bump (`^16.2.11` → `^16.3.0`) alongside its feature work. The next `Docker Release` run failed on `main` and again on the `v1.7.0` tag, both at `RUN bun run build`:

```
panic: Segmentation fault at address 0x13CB0
error: script "build" was terminated by signal SIGILL (Illegal instruction)
ERROR: process "/bin/sh -c bun run build" did not complete successfully: exit code: 132
```

The build *succeeds* first — it prints its full route table — then Bun crashes on exit, so the layer fails with 132 despite the artifacts being complete.

Per [oven-sh/bun#36866](https://github.com/oven-sh/bun/issues/36866), the fault is in Bun's `napi.ThreadSafeFunction.scheduleDispatch`: next-swc's Turbopack addon releases a napi threadsafe function after the worker thread that created it has been torn down, and `next build` spawns exactly such workers for page-data collection. Fixed on Bun `main` by PRs #34067/#34026 — both merged *after* 1.3.14 was cut, so the fix exists only in canary (1.4.0-canary).

Two properties made this expensive to find, and both are the real lesson:

1. **CI could not see it.** `ci`'s `bun run build` runs under `setup-bun`'s non-baseline x64 binary; the `oven/bun` image ships `Linux x64 (baseline)`. The crash is baseline-only, so CI stayed green while releases broke.
2. **Nothing built the image before release.** `ci.yml` had no Docker build step, so image-build breakage could only surface at `git push --tags`. `v1.7.0` therefore exists as a tag with no GHCR image and — because `github-release` runs only after a successful push — no GitHub Release.

Both were reproduced locally on `linux/amd64` with a byte-identical crash address, confirming determinism rather than a flaky runner.

## Decision

Pin `next` to exactly **16.2.11** (not `^16.2.11`, which re-resolves to 16.3.0), with a matching Dependabot `ignore` for minor and major updates so the pin is not silently reverted by the daily `bun` ecosystem run. Patch updates within 16.2.x stay enabled.

Separately and independently, add a `docker` job to `ci.yml` that builds the real image from the real Dockerfile on the release platforms, so this class of failure surfaces on the PR rather than at tag time.

Revisit when **either** trigger fires:
- Bun **stable** ships #34067 (watch oven-sh/bun#36866), or
- a Next advisory lands that is patched only in ≥16.3, which would force the move regardless.

## Alternatives Considered

### Alternative 1: Downgrade Bun in the Dockerfile
- **Pros**: keeps Next current; touches only the image, not the app.
- **Cons**: verified locally to be *worse*. Bun 1.3.10–1.3.13 fail earlier and harder — `Expected CommonJS module to have a function wrapper` loading `next/dist/compiled/next-server/app-page-turbo.runtime.prod.js`, a separate bug that 1.3.14 itself fixed. The build does not merely crash on exit; it never completes.
- **Why not**: strictly regressive. There is no Bun version that builds Next 16.3.0.

### Alternative 2: Move the build to Bun canary
- **Pros**: upstream-confirmed to fix the crash; keeps Next 16.3.0.
- **Cons**: canary is Bun **1.4**, a mid-flight major (the Rust rewrite), not a 1.3.15 backport. It writes a 1.4-format lockfile, so `bun install --frozen-lockfile` — used in both Dockerfile stages and twice in `ci.yml` — fails against the committed 1.3.x `bun.lock`. Upstream reporters also hit resolution/hoisting differences that broke `next build`'s type check. `oven/bun:canary` moves daily, against a Dockerfile whose install step exists for reproducibility.
- **Why not**: adopting an unreleased major across CI, local dev, and published images to dodge one already-fixed bug.

### Alternative 3: Split the builder — Bun installs, Node runs `next build`
- **Pros**: keeps Next 16.3.0 and all future 16.x; Bun still owns installation, so `bun.lock` and the Dependabot `bun` ecosystem are untouched; the runner stays on Bun, leaving the `bun` uid and the `/data/uploads` ownership fix alone; the Node layer is discarded by the multi-stage build, so final image size is unchanged. **Verified**: builds clean on `linux/amd64` with Next 16.3.0, including the native addons (`sharp`, `sodium-native`) installed by Bun and executed by Node.
- **Cons**: two runtimes in one Dockerfile, and the image build path diverges from what `ci`'s `bun run build` exercises. Temporary complexity that someone must not "simplify" away.
- **Why not**: viable and kept in reserve, but the pin costs nothing today — 16.2.11 is the security-patched release, so nothing is being given up. Revisit this option if the wait for Bun 1.4 stable turns out to be long.

### Alternative 4: Migrate off Bun to Node or Deno
- **Pros**: Node is the reference runtime Next is built and tested against; removes this class of risk at the source.
- **Cons**: Bun is four roles here, not one dependency — 106 files import `bun:test`, `bunfig.toml`'s `[test] preload` bootstraps the Testcontainers Postgres, `mock.module`/`Bun.spawn`/`Bun.file` are used directly, and `db:migrate`/`seed:*` execute TypeScript directly. Deno is worse still: it reimplements napi too, so it re-rolls the same dice at the same boundary, with a weaker fit for this app's native addons.
- **Why not**: a multi-day, ~110-file migration behind a MUST-PASS `ci-check` gate, to route around a bug already fixed upstream whose blast radius is one `RUN` line.

## Consequences

### Positive
- `Docker Release` builds again; v1.7.0 can be re-cut.
- No security posture is given up: every open 16.x advisory (four HIGH SSRF, several MODERATE) lists `16.2.11` as `firstPatchedVersion`, and 16.2.x patches still flow.
- The new `docker` CI job closes the structural gap, so the *next* image-build break is caught on a PR regardless of cause.

### Negative
- The project trails Next by a minor, and 16.3.x features are unavailable.
- The Dependabot `ignore` suppresses the recurring-PR nag, so this ADR becomes the tracking mechanism — the same tradeoff ADR-0010 accepted for `typescript`.

### Risks
- The deferral drifts if Bun retires the 1.3.x line in favor of 1.4 stable, which could be a long wait; upstream has not committed to a 1.3.15 backport. **Mitigation**: the second revisit trigger (a Next advisory patched only in ≥16.3) forces the decision on security grounds rather than letting it drift, and Alternative 3 is verified and ready if the wait becomes untenable.
