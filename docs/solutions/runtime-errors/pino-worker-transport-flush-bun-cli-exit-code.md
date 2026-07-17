---
title: "Pino worker-transport logging swallows a one-shot CLI's exit code under Bun"
date: 2026-07-17
category: runtime-errors
module: src/db/migrate
problem_type: runtime_error
component: tooling
symptoms:
  - "A failed `bun run db:migrate` exits 0 instead of 1 — CI and the calling shell read a failed migration as success"
  - "`pino`'s `logger.flush(cb)` callback never fires under Bun when the logger uses worker-thread transports"
  - "The success/failure log line is dropped or truncated in a short-lived CLI that calls `process.exit()`"
tags: [pino, bun, logging, worker-threads, thread-stream, exit-code, cli, flush, process-exit, migration]
---

# Pino worker-transport logging swallows a one-shot CLI's exit code under Bun

## Problem

A standalone CLI (`src/db/migrate.ts`, run via `bun run db:migrate`) that logs through a Pino logger backed by worker-thread transports (`pino.transport({ targets })`, e.g. `pino-pretty` / `pino-roll` / `pino/file`) can never reliably reach its own `process.exit(1)`. Under Bun, the process instead exits `0` via the runtime's natural path once the unref'd worker-thread handle drops — silently turning a **failed** migration into a reported **success** for CI and the calling shell.

## Symptoms

- `bun run db:migrate` against a broken/unreachable `DATABASE_URL` prints (or half-prints) an error but exits with code **0**.
- Awaiting `logger.flush()` hangs, or a statement placed immediately after the `flush` callback never runs — the callback never fires.
- The final success/failure log line is missing or truncated because the buffered transport never drained before the process ended.
- Everything looks fine interactively (a human sees output scroll by); only CI's exit-code check, or a scripted `expect exitCode === 1`, exposes it.

## What Didn't Work

- **Reusing the shared app logger (`childLogger` from `src/lib/logging`) in the CLI.** That logger fans out to `thread-stream` worker-thread transports (needed for the long-lived Next server's stdout + rotating file). It's the wrong tool for a one-shot process.
- **Draining with `logger.flush(cb)` before `process.exit()`** (the plan's original instruction). Verified directly under Bun: the flush callback never fired, so either the `await` hung or `process.exit(1)` was skipped entirely and the runtime exited 0 on its own.
- **Trusting the default Pino destination to be synchronous.** `pino({ level })` with no destination uses a buffered `SonicBoom` (`sync: false`) in Pino v10; an immediate `process.exit()` can still drop the last line even without worker threads.

## Solution

Give the CLI a dedicated, **synchronous, no-transport** Pino instance writing straight to fd 1. Keep the ALS correlation helpers (they have no Pino dependency), just not the worker-transport logger. From `src/db/migrate.ts:25-28`:

```ts
// Explicitly synchronous destination — sync:true guarantees each line is
// fully written to stdout before the next statement runs, so process.exit()
// can't race a buffered/worker flush.
const log = pino(
  { level: resolveLogEnv().level },
  pino.destination({ dest: 1, sync: true }),
).child({ module: "migrate" });
```

Before (buffered default destination, or the worker-transport `childLogger`):

```ts
const log = pino({ level: resolveLogEnv().level }).child({ module: "migrate" });
```

Long-lived server processes (`next start`) keep the shared worker-transport logger — its async batching is correct there and it never calls `process.exit()`.

## Why This Works

`pino.destination({ dest: 1, sync: true })` is an in-process synchronous `SonicBoom` write: each `log.info`/`log.error` call has fully written to stdout before control returns, so there is no pending buffer and no worker thread to race against `process.exit()`. The failure path's `process.exit(1)` runs with all output already flushed, so the real exit code reaches the shell. The worker-thread transport model is built for throughput in a long-running process where an event loop stays alive to drain the buffer — the opposite of a script whose whole job is to run once and exit with a meaningful code.

## Prevention

- **For any short-lived CLI/script under `bun run` that must return a meaningful exit code, use a synchronous no-transport logger** (`pino.destination({ dest: 1, sync: true })`), not the app's shared worker-transport logger. Reserve worker transports for long-lived processes.
- **Regression-test the exit code as a subprocess.** A same-process test can't assert this (the script calls `process.exit()` inside the runner). Spawn it and assert the code on both paths — see `src/db/__tests__/migrate-exit-code.test.ts`:

  ```ts
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/db/migrate.ts"],
    env: { ...process.env, DATABASE_URL: unreachableUrl }, // closed port → fast fail
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(1); // the whole point: failure must NOT report success
  ```

  The failure path needs no database (target a closed loopback port for a fast `ECONNREFUSED`); gate the container-backed success path on `DATABASE_URL` per repo convention.
- **Treat "logging works interactively" as no signal for exit-code correctness.** A human watching output can't see a swallowed exit code; only a scripted check can.

## Related Issues

- [Native Node addons (sodium-native) break the Next.js 16 Turbopack build without serverExternalPackages](../build-errors/sodium-native-nextjs16-serverexternalpackages.md) — the sibling worker-thread/native-binding quirk from the same logging work: Pino's transports also need `serverExternalPackages` so Turbopack doesn't bundle their worker scripts.
- Shipped in PR #71 / #75 (structured logging with Pino); the CLI fix lives in `src/db/migrate.ts`.
