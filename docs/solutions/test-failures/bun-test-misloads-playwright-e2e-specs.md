---
title: "Raw `bun test` mis-loads Playwright e2e specs and reports phantom failures"
date: 2026-07-06
category: test-failures
module: e2e-harness
problem_type: test_failure
component: testing_framework
severity: medium
root_cause: config_error
resolution_type: workflow_improvement
symptoms:
  - "`bun test` reports a batch of failures like `15 fail / 15 errors` that are not real regressions"
  - "Errors read `Playwright Test did not expect test() to be called here` originating from files under `e2e/`"
  - "The same code passes when run through the project's scoped test scripts"
tags: [bun, playwright, e2e, test-runner, testcontainers, nextjs, monorepo-scripts]
---

# Raw `bun test` mis-loads Playwright e2e specs and reports phantom failures

## Problem

Running `bun test` (the bare command) in this repo collects and tries to execute the Playwright specs under `e2e/*.spec.ts` with Bun's own test runner. Playwright's `test()` refuses to run outside the Playwright runner, so those files error out — producing a scary "15 fail / 15 errors" summary that looks like a real regression but is purely a test-runner mismatch.

## Symptoms

```
$ bun test
error: Playwright Test did not expect test() to be called here.
...
      at .../e2e/theme.spec.ts:21:1

 276 pass
 15 fail
 15 errors
Ran 291 tests across 46 files.
```

The 15 failures/errors all originate from files under `e2e/`; the 276 passes are the real `src/` unit + integration suite.

## What Didn't Work

- **Reading the failures as a code regression.** After a value-preserving CSS-token rename, seeing 15 failures immediately after the change suggests the change broke something. It did not — none of the failing files are exercised by the change, and the failure text is a runner error, not an assertion failure.
- **Assuming `bun test` is the project's test command.** It is the Bun default, but this repo does *not* use it directly; the real suites are wrapped in scoped scripts.

## Solution

Use the project's scoped scripts, never bare `bun test`:

```jsonc
// package.json
"scripts": {
  "test":     "bun test src",     // unit + integration only (Postgres-gated on DATABASE_URL)
  "test:e2e": "playwright test"   // Playwright runner; Docker/Testcontainers required
}
```

- Unit / integration: `bun run test` (scoped to `src/`, so `e2e/` is never collected).
- End-to-end: `bun run test:e2e` (the Playwright runner).
- Full gate: `just ci-check` (lint, format-check, typecheck, pre-commit-run, `test`, `test-e2e`) — the mandatory pre-commit gate.

Run through the scoped scripts and the phantom failures disappear (`276 pass / 0 fail`); the e2e suite runs green under Playwright (`24 passed`).

## Why This Works

`bun test <path>` globs every `*.test.ts` / `*.spec.ts` it can find under the given path. Bare `bun test` defaults to the whole repo, which sweeps in `e2e/*.spec.ts` — Playwright specs that must run under the `playwright` binary, not Bun. Scoping to `src` (`bun test src`) excludes `e2e/` by path, and `playwright test` owns the e2e specs with the correct runner and its Testcontainers/Docker setup. The two runners never see each other's files.

## Prevention

- **Always invoke the scoped scripts** (`bun run test`, `bun run test:e2e`) or the full `just ci-check` — treat bare `bun test` as "wrong tool" in this repo.
- **When a post-change test run shows failures, check the failure *type* before the *count*.** A `Playwright Test did not expect test() to be called here` (or any "runner X did not expect Y") message is a collection/runner mismatch, not a code regression — look at which runner loaded which files before diagnosing the code.
- This mirrors the repo's testing rule: integration/e2e run via Testcontainers under Playwright; see AGENTS.md and [[e2e-dotenv-mise-clobbers-launcher-env]] for the e2e harness details.
