---
title: "Native Node addons (sodium-native) break the Next.js 16 Turbopack build without serverExternalPackages"
date: 2026-07-13
category: build-errors
module: backup
problem_type: build_error
component: bundler
severity: high
root_cause: config_error
resolution_type: config_change
symptoms:
  - "`next build` fails with `ADDON_NOT_FOUND` (e.g. `sodium-native/binding.js`)"
  - "The failure takes down the whole-app production build, not just the route that imports the addon"
  - "Unit tests, `tsc --noEmit`, and lint all pass — only the production build tracer surfaces it"
  - "Any route whose module graph transitively touches the native addon fails to build"
tags: [nextjs, nextjs16, turbopack, native-addon, sodium-native, serverExternalPackages, trustedDependencies, bun, build]
---

# Native Node addons (sodium-native) break the Next.js 16 Turbopack build without serverExternalPackages

## Problem

Adding a native Node addon consumed by server code (here, `sodium-native` for the encryption-at-rest backup crypto in `src/backup/crypto.ts`) makes `next build` fail with `ADDON_NOT_FOUND`, taking down the entire production build — even though unit tests, typecheck, and lint are all green.

## Symptoms

- `next build` errors with `ADDON_NOT_FOUND` referencing the addon's loader (e.g. `sodium-native/binding.js`).
- The failure is app-wide: any route whose graph transitively imports the addon fails, so both `app/api/admin/backup/export/route.ts` and `.../restore/route.ts` (and anything importing `src/backup/crypto.ts`) go down.
- `bun test`, `bun run typecheck` (`tsc --noEmit`), and `bun run lint` (Biome) all pass — none of them exercise the production build tracer, so the break is invisible until `next build` / the `e2e` job runs.

## What Didn't Work

- Relying on the unit/type/lint gate to catch it. The addon loads fine at runtime under `bun test` (native binding resolves normally in the test process), so the whole test suite is green while the production build is broken. The signal only appears in `next build`.

## Solution

Add the native package to `serverExternalPackages` in `next.config.ts` so Turbopack leaves it external instead of tracing/relocating its loader:

```ts
// next.config.ts
const nextConfig = {
  serverExternalPackages: ["sodium-native"],
  // ...
};
```

And — because this repo uses Bun — add the same package to `trustedDependencies` in `package.json` so Bun actually runs its native build step on install:

```jsonc
// package.json
"trustedDependencies": ["sharp", "unrs-resolver", "sodium-native"]
```

Verify with a real `next build` (or the `e2e` job, which builds the app), not just `bun test` / `tsc`.

## Why This Works

Native addons resolve their compiled `.node` binary via a runtime **relative** path from their loader (`binding.js`). Turbopack's page-data tracing copies/relocates that loader when bundling the server graph, which breaks the relative lookup at load time → `ADDON_NOT_FOUND`. Listing the package in `serverExternalPackages` tells Next.js to treat it as an external server dependency and not trace/relocate it, so the loader keeps its original layout and finds its binary. The `trustedDependencies` entry is orthogonal but necessary under Bun: Bun skips postinstall/native-build scripts for any package not on that allowlist, so without it the addon may never be built in the first place (a separate failure mode — see the module `AGENTS.md` note on Bun hooks).

## Prevention

- **When adding any native (`.node`) addon consumed server-side, in the same change:** (1) add it to `serverExternalPackages` in `next.config.ts`, and (2) add it to `package.json` `trustedDependencies` (Bun).
- **Don't trust the unit/type/lint gate for this class of bug** — it can't see it. Ensure CI runs a real `next build` (this repo's `ci`/`e2e` GitHub Actions jobs do), so an addon-tracing regression fails loudly in CI rather than at deploy time.
- Quick smell test when a server dependency ships a `binding.js` / `prebuilds/` / `build/Release/*.node`: it's a native addon, so it likely needs the `serverExternalPackages` treatment.
