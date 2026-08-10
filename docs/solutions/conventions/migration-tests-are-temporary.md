---
title: "Migration tests are temporary — keep about two releases, then delete"
date: 2026-08-10
category: conventions
module: db/migrations
problem_type: convention
component: testing_framework
severity: medium
applies_when:
  - "Deciding whether a `src/db/__tests__/migration-00NN-*.test.ts` file still earns its place"
  - "Adding a migration test for a destructive or data-converting migration — it should be written knowing it will be retired"
  - "Investigating slow integration runs or orphaned Testcontainers Postgres containers"
related_components: [database, development_workflow]
tags: [migrations, testing, test-lifecycle, testcontainers, suite-runtime, drizzle]
---

# Migration tests are temporary — keep about two releases, then delete

## Context

A data-converting migration gets a dedicated test because the conversion is destructive, irreversible, and runs exactly once against real data. That test is genuinely valuable — right up until the conversion has happened everywhere it will ever happen.

MagStacker currently has **one deployment**. So a migration that converts pre-existing rows executes against real data exactly once, on that instance. Every run afterwards — every CI run, every fresh install — applies it to an empty database, where the interesting branches never fire. From then on the test is asserting history: *if it worked before, it shouldn't stop working.*

The cost is not zero. These tests stand up their own Postgres containers outside the shared preload in `src/test-support/preload.ts`, because they must migrate to an intermediate revision and seed pre-migration rows. The retired `0020` test started **three** containers with 60-second timeouts. Containers created outside the shared harness are also the likeliest source of orphaned Testcontainers Postgres instances when a run is interrupted.

## Guidance

**Keep a migration test for roughly two releases after its migration ships, then delete it.** Releases are the `v*.*.*` tags cut by hand, so the count is checkable:

```bash
git log -1 --diff-filter=A --format=%h -- src/db/migrations/00NN_*.sql   # when it landed
git describe --contains <that-commit>                                     # which release contains it
git tag --sort=-creatordate | head                                        # releases since
```

**Before deleting, separate two kinds of assertion in the file:**

- **Historical** — the conversion itself, count reconciliation, the abort/rollback path. These only ever mattered during the one-time upgrade. They go.
- **Live schema** — a CHECK still being enforced, a column that became nullable, a new legal `grant` parent type, a trigger that still fires. These describe the schema as it is *today* and must survive, either because they are already covered elsewhere or by being ported to a test that uses the shared preloaded container.

Deleting the historical half is free. Deleting the live half silently removes a guard, which is the one way this convention can go wrong.

## Why This Matters

Migration tests accumulate. Each one is written at maximum anxiety — the migration is destructive and irreversible, so the test is thorough — and then never revisited, because nothing ever fails to remind you it exists. Left alone they become a slow, container-hungry archive of upgrades nobody will perform again.

Retiring them on a schedule keeps the suite honest about what it is protecting: the schema you have, not the sequence of edits that produced it.

## When to Apply

- **Fewer than two releases since the migration shipped** → keep the test as-is.
- **Two or more** → delete it, after confirming its live-schema assertions are covered elsewhere.
- **Single-deployment reasoning can retire one early**, as it did below — if the only instance that could ever run the conversion has already run it, the historical half is dead weight regardless of tag count.

## Examples

**Deleted at one release — `migration-0020-service-event-conversion.test.ts`.** It covered the `cleaned`/`lubed` → `service_event` conversion, which landed in `v1.6.0`. Three describe blocks: the conversion against seeded data, an empty-database case, and a forced-reconciliation-mismatch rollback. Only one assertion in it was live rather than historical — that the narrowed `inventory_log_event_type_valid` CHECK still rejects a firearm `cleaned` row — and that was already covered against the shared container:

```
src/domain/inventory-log/__tests__/service.test.ts
  "R3 backstop: the DB rejects a direct insert of a retired 'cleaned' row
   for a firearm after the CHECK was narrowed (U5)"
```

With that confirmed, the file was removed (`src/db/__tests__/migration-0020-service-event-conversion.test.ts` no longer exists as of this doc).

**Kept — `src/db/__tests__/migration-0022-accessory-type-backfill.test.ts`.** The accessory type backfill has not appeared in a tagged release yet, so it does not meet the bar. It also carries several live-schema assertions that would need porting first rather than dropping: the `accessory_type_valid` CHECK, `category` having become optional, and `accessory` being a legal `grant` parent type whose cleanup trigger fires on delete.

One further reason these tests are costly to keep correct: drizzle's migrator applies every journal entry newer than the latest `when` timestamp a database has recorded — a high-water mark, not a per-file hash check. So a test that migrates to an intermediate revision must truncate the journal **by index**, not by tag name; leaving a later migration in place moves the high-water mark past the one under test and silently skips it. That subtlety has to be re-derived by anyone maintaining such a test, which is effort better not spent on an upgrade that will never run again.
