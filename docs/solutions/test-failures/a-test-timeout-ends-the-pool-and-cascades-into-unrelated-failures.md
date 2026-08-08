---
title: "A bun test timeout is not contained: afterAll ends the pool under the still-running body and the rest of the file fails for the wrong reason"
module: testing
date: 2026-08-08
problem_type: test_failure
component: testing_framework
severity: medium
root_cause: configuration
resolution_type: test_fix
related_components:
  - database
  - development_workflow
tags:
  - bun
  - testcontainers
  - timeout
  - flaky
  - pg-pool
  - ci
---

# A bun test timeout is not contained, and the cascade names the wrong tests

## Problem

`just ci-check` failed in `src/backup` on a different, larger subset of tests
on each run, while every one of those files passed 14/14 in isolation. The
failure text pointed at pooling and at a missing snapshot schema — neither of
which had anything to do with the change under test.

The trigger is bun's 5-second default timeout applied to suites that start
their own Postgres via Testcontainers.

## Symptoms

- A different set of tests fails each run; re-running "fixes" it.
- Per-file runs are green, so the natural conclusion is "flaky infrastructure".
- Failures appear as `Cannot use a pool after calling end on the pool` and
  `Failed query: …` on tests that never time out themselves.
- The genuinely-timed-out test is buried among cascade victims, and its
  duration (`[5023.53ms]`, `[5036.84ms]`) is the only tell — a cluster of
  durations pinned just above 5000ms is a timeout, not slow code.

## What Didn't Work

- **Running the file in isolation.** 14/14 green, every time. Isolation removes
  the load that causes the timeout, so it disproves nothing — and it is exactly
  what makes the problem look like flake.
- **Blaming a loud ERROR log in the output.** The suite logs
  `relation "restore_snapshot_<hex>.operator_audit" does not exist` at ERROR
  level from a deliberate rollback-failure test. It appears in fully **passing**
  runs too. Grepping the log for scary text found this first and sent the
  investigation the wrong way.
- **Dismissing it as load-induced and moving on.** True but not a diagnosis. It
  was waved off twice on that basis while it kept blocking a mandatory gate.
- **Scoping the fix to the one file that had failed.** The next gate run failed
  the same way in `routes.test.ts`. Every suite under `src/backup` starts its
  own container and does real bundle work per test, so they all sit against the
  same tripwire.

## Solution

A shared helper, imported **aliased** so call sites are untouched
(`src/test-support/container-test.ts`):

```ts
export const CONTAINER_TEST_TIMEOUT_MS = 60_000;

export function containerTest(name: string, body: () => void | Promise<unknown>): void {
  bunTest(name, body, CONTAINER_TEST_TIMEOUT_MS);
}
```

```ts
// in each container-backed suite — every existing `test("...")` call stays as-is
import { containerTest as test } from "../../test-support/container-test";
```

The aliasing is not cosmetic. Renaming 78 call sites to `containerTest(` pushes
the argument lists past the formatter's wrap column and reflows the indentation
of every test body — a 930-line diff for a one-line change. Aliasing keeps the
whole change to one import line per file.

Confirm the timeout is actually in effect rather than assuming it: inject a
test that sleeps 6 seconds and watch it pass where the 5s default would kill it.

## Why This Works

Bun marks a timed-out test as failed but **does not stop its body**. The suite
proceeds to `afterAll`, which runs `await pool?.end()` and `container?.stop()`
while the abandoned body still holds queries in flight. Every subsequent query
— from that body and from the remaining tests — hits a dead pool.

So one timeout produces N failures, and none of the N names the real problem.
The subset differs per run because which test trips first depends on load,
which is what makes it read as randomness.

60 seconds is roughly 7x the slowest observed legitimate run (~8s), so a
genuine hang still fails, just later.

## Prevention

**Do not raise the suite-wide default.** The ~1250 tests that never touch a
container have no business taking seconds, and should keep a tight tripwire.
Scope the longer timeout to the suites that actually pay container costs.

**Read durations before reading messages.** A cluster of failures pinned just
above the timeout value is a timeout cascade. The error text in that situation
describes the teardown, not the defect.

**Distrust "passes in isolation" as exoneration.** For load-sensitive failures
it is the expected result on both a healthy and a broken suite, so it carries
no signal. Reproduce under the same conditions the gate runs under.

**Expect the class to be wider than the first file.** Timeout cascades cluster
by *resource cost*, not by feature. Once one container-backed suite trips it,
assume its siblings will and check them in the same pass.

**Prefer aliased imports over renames in large test files.** Any identifier
change that alters line width will reflow formatted bodies and bury a one-line
change in hundreds of lines of noise.
