---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: GitHub issue #47
type: refactor
title: "refactor: Remove shadcn token bridge; adopt shadcn tokens everywhere"
created: 2026-07-05
depth: standard
---

# refactor: Remove shadcn token bridge; adopt shadcn tokens everywhere

**Origin:** GitHub issue #47 — "Remove shadcn token bridge; adopt shadcn tokens everywhere"

**Product Contract preservation:** Solo/bootstrap plan (no upstream `ce-brainstorm` artifact); scope taken directly from issue #47.

---

## Summary

`app/globals.css` currently carries a **temporary token bridge** (introduced by the data-table shadcn PR): a `:root` alias block mapping shadcn's semantic tokens (`--background`, `--foreground`, `--primary`, `--border`, `--ring`, …) onto the DESIGN.md "Machined Console" tokens (`--paper`, `--ink`, `--blaze`, `--line`, …). The bridge let shadcn-generated components render on-brand without per-component restyling. This plan removes the **alias indirection** and standardizes the app on shadcn's token names — defining the theme values *directly* under shadcn-canonical names, keeping the DESIGN.md palette's extra semantic tokens as first-class custom tokens, and migrating every consumer utility class off the old raw names.

The migration exploits a property of the current state: **the bridge already makes shadcn utilities work today** (`bg-background`, `text-foreground`, `border-border`, … all resolve per-theme right now). So consumers can migrate to shadcn names *while the bridge is still live and working*, and the bridge is deleted only after every consumer is off the old names. No temporary alias layer is needed and no commit leaves the app in a broken state.

---

## Problem Frame

The bridge is double-indirection: `bg-paper` → `--color-paper` → `var(--paper)` and separately `bg-background` → `--color-background` → `var(--background)` → `var(--paper)`. Two token vocabularies coexist (raw Machined Console names + shadcn semantic names), the app is in a mixed state (some components already use `border-border bg-card`, most still use `border-line bg-paper-raised`), and the bridge block is explicitly marked `TEMPORARY` with a `TODO(remove)` pointing at this issue.

**In scope:** collapse to one token vocabulary (shadcn-canonical + a small set of directly-defined custom extensions), migrate all consumers, delete the bridge, reconcile the radius scale, update DESIGN.md, verify both themes.

**Out of scope:** changing any rendered color/spacing value (this is a value-preserving rename), adding new shadcn components, restyling, or renaming the extended custom tokens to invented shadcn-ish names (e.g. `ok → success`).

---

## Key Technical Decisions

### KTD-1 — Extended tokens must survive as first-class, directly-defined tokens (determined, not preference)

The Machined Console palette is **richer than shadcn's 18 default tokens.** Four tokens have no shadcn analog, and the text ramp is three levels deep where shadcn has two:

- `--ink-soft` (25 uses) — the middle of the `--ink` / `--ink-soft` / `--ink-faint` ramp; shadcn only has `--foreground` + `--muted-foreground`.
- `--steel` — informational accent, no shadcn analog.
- `--ok` (5+ uses) — success color, no shadcn analog.
- `--danger-soft` (3 uses) — destructive tint; shadcn's `--destructive-foreground` is a different value (`--blaze-ink`), not a tint.

The issue's own acceptance criteria **force** keeping these: "keep the dark/light values" + "pass contrast/visual review" means any collapse of these into shadcn defaults would *change the rendered design* and fail the visual gate. This is therefore not a judgment call. Extended tokens are defined **directly** in the theme blocks (`:root` / `[data-theme]`) with their own `@theme inline --color-*` mappings, exactly like the shadcn-canonical tokens — the only thing removed is the *alias indirection*, not the tokens. Adding custom semantic tokens alongside shadcn's defaults is idiomatic shadcn.

### KTD-2 — Keep the full shadcn-canonical token set defined

Define all of shadcn's canonical tokens directly with values. Rationale is present-tense, not speculative: shadcn's component templates assume the full canonical set is defined, so a *partial* definition is itself the anomaly — and some of these are already live consumers today (`--popover`/`--popover-foreground` are used by `components/ui/dropdown-menu.tsx`; `--card`, `--muted`, `--accent`, `--destructive`, `--border` are used across the data-table components). Only `--secondary`, `--secondary-foreground`, and `--card-foreground` currently have zero utility uses; keep them defined so the set is coherent for the next shadcn component rather than leaving a partial set that renders nothing on first reference. "Which canonical tokens are *defined*" (all of them) is separate from "which utilities the app *migrates to*" (only the ones it uses). This is a deliberate, bounded exception to YAGNI — completing an already-adopted token contract, not building speculative infrastructure.

### KTD-3 — Value-preserving rename mapping

Migrate consumers per this table. Per-use judgment (e.g. `text-blaze` on an accent surface is `text-accent-foreground`, elsewhere `text-primary`) is left to the implementer.

| Machined Console (raw) | Fate | shadcn canonical | Utility migration |
|---|---|---|---|
| `--paper` | rename | `--background` | `bg-paper` → `bg-background` |
| `--paper-raised` | rename | `--card` (+ `--popover`) | `bg-paper-raised` → `bg-card` |
| `--paper-sunken` | rename | `--muted` (`--secondary` also defined, same value) | `bg-paper-sunken` → `bg-muted` |
| `--ink` | rename | `--foreground` | `text-ink` → `text-foreground` |
| `--ink-soft` | **keep custom** | — | unchanged (`text-ink-soft`) |
| `--ink-faint` | rename | `--muted-foreground` | `text-ink-faint` → `text-muted-foreground` |
| `--line` | rename | `--border` | `border-line` → `border-border` |
| `--line-strong` | rename | `--input` | `border-line-strong` → `border-input` |
| `--blaze` | rename | `--primary` (+ `--ring`, `--accent-foreground`) | `bg-blaze`→`bg-primary`; `border-blaze`/`focus:border-blaze`→`border-primary` (incl. `border-blaze/30`); `text-blaze`→`text-primary`/`text-accent-foreground` per use |
| `--blaze-ink` | rename | `--primary-foreground` (+ `--destructive-foreground`) | `text-blaze-ink` → `text-primary-foreground` |
| `--blaze-soft` | rename | `--accent` | `bg-blaze-soft` → `bg-accent` |
| `--steel` | **keep custom** | — | unchanged |
| `--danger` | rename | `--destructive` | `text-danger`→`text-destructive`, `bg-danger`→`bg-destructive`, `border-danger`→`border-destructive` |
| `--danger-soft` | **keep custom** | — | unchanged (`bg-danger-soft`) |
| `--ok` | **keep custom** | — | unchanged (`--color-ok` already exists, so `bg-ok`/`text-ok` work; existing `bg-[var(--ok)]` arbitrary forms may be normalized to `bg-ok`) |

### KTD-4 — Verification is a dangling-reference problem, not a contrast problem

A value-preserving rename cannot drift contrast by construction. The real risk is a **missed** `bg-paper` / `var(--line)` pointing at a now-undefined token — **Tailwind v4 silently generates nothing for an unknown utility; there is no build error.** So the primary gate is a **grep-gate**: after migration, zero matches for old token names and utilities across `app/`, `components/`, and `app/globals.css`. Sequence is load-bearing: migrate all consumers → grep-gate consumers clean → delete definitions + bridge → full grep-gate → e2e/visual.

### KTD-5 — Radius scale reconciliation

Keep the `@theme inline` shadcn radius scale (`--radius-sm/md/lg/xl` derived from the two anchors `--radius` = 0.375rem and the frame radius 0.625rem). Migrate the arbitrary radius forms to shadcn utilities:

- `rounded-[var(--radius-lg)]` → `rounded-lg` (0.625rem, 8 uses)
- `rounded-[var(--radius)]` → `rounded-md`
- `rounded-[calc(var(--radius)-2px)]` → `rounded-sm`

The raw `--radius-lg` var remains defined (it anchors `rounded-lg`); only the arbitrary consumer forms change.

---

## Assumptions

Recorded per headless (pipeline) mode — surfaced for review, not blocking:

- **A1:** Extended tokens keep their existing names (`ink-soft`, `steel`, `ok`, `danger-soft`) rather than being renamed to shadcn-idiomatic names. Rationale: KTD-1 + minimize churn beyond the issue.
- **A2:** `--paper-sunken` consumers migrate to `bg-muted` (not `bg-secondary`), since `bg-muted` is already the token in active use and `--secondary` has zero current utility uses. Both remain defined (KTD-2).
- **A3:** `--line-strong` → `--input` even for non-input borders (toolbars, toggles), following shadcn's convention that `--input` is the interactive-control border token.
- **A4:** DESIGN.md's token spec block is updated to the new canonical names for renamed tokens; extended tokens keep their names. This is a modest doc edit, not a rewrite.

---

## Output Structure

No new files. All changes are edits to existing files: `app/globals.css`, `DESIGN.md`, and utility-class edits across `components/ui/**` and `app/**`.

---

## Implementation Units

### U1. Migrate `components/ui/**` to shadcn token utilities

**Goal:** Replace raw Machined Console utility classes with shadcn-canonical equivalents (per KTD-3) across the shared UI component library, including radius arbitrary forms (KTD-5). The bridge is still live, so every replacement resolves correctly on both themes immediately.

**Requirements:** Issue task 2 (component migration), task 3 (radius reconciliation, component side).

**Dependencies:** none.

**Files:** `components/ui/button.tsx`, `input.tsx`, `select.tsx`, `surface.tsx`, `toast.tsx`, `field.tsx`, `feedback.tsx`, `confirm-dialog.tsx`, `theme-toggle.tsx`, `table.tsx`, `dropdown-menu.tsx`, `collapsible.tsx`, `console-signature.tsx`, `data-table/data-table.tsx`, `data-table/pagination.tsx`, `data-table/data-table-toolbar.tsx`, `data-table/column-menu.tsx`, `data-table/grouped-table-view.tsx`.

**Approach:** Mechanical, per KTD-3 mapping. Cover every form: bare (`text-ink`), opacity variants (`bg-paper-sunken/50`, `bg-ink/30`, `border-danger/40`), and arbitrary radius (`rounded-[var(--radius-lg)]` → `rounded-lg`). Leave extended-token utilities (`text-ink-soft`, `text-steel`, `bg-danger-soft`, `bg-[var(--ok)]`) unchanged. Apply the per-use judgment for `text-blaze` (accent surface → `text-accent-foreground`; otherwise `text-primary`).

**Execution note:** Purely presentational, value-preserving edits — verify via visual render + the U6 grep-gate rather than new unit tests. The `Files` list is a starting checklist; re-run the raw-token grep across `components/` to confirm completeness. Prefer a scripted substitution for the unambiguous 1:1 KTD-3 rows, reserving manual edits for the per-use `text-blaze` judgment.

**Patterns to follow:** `data-table/grouped-table-view.tsx` already uses `border-border bg-card` — match that shadcn idiom across the rest.

**Test scenarios:** `Test expectation: none -- value-preserving CSS-class rename; behavior unchanged. Coverage is the U6 grep-gate + existing e2e/visual review.`

**Verification:** No raw token utility classes remain in `components/ui/**`; components render identically on both themes with the bridge still present.

---

### U2. Migrate `app/**` route components to shadcn token utilities

**Goal:** Same mechanical migration as U1 across the route/surface components.

**Requirements:** Issue task 2, task 3 (radius, app side).

**Dependencies:** none (independent of U1; may run in parallel).

**Files (starting checklist, not a closed set — the U6 grep-gate is the authoritative completeness check):** `app/(app)/app-shell.tsx`, `app/(app)/not-found.tsx`, `app/(app)/settings/settings-form.tsx`, `app/(app)/grants/grants-list.tsx`, `app/(app)/grants/share-control.tsx`, `app/(app)/magazines/magazine-detail-view.tsx`, `app/(app)/magazines/magazines-view.tsx`, `app/(app)/magazines/magazine-form.tsx`, `app/(app)/magazines/export-button.tsx`, `app/(app)/firearms/range-session-history.tsx`, `app/(app)/firearms/firearms-view.tsx`, `app/(app)/firearms/firearm-detail-view.tsx`, `app/(app)/summary/summary-tables.tsx`, `app/(admin)/users/admin-users.tsx`, `app/(auth)/login/page.tsx`.

**Approach:** Identical to U1. Watch for opacity variants (`bg-paper/85`, `bg-blaze-soft/45`) and arbitrary radius forms in `share-control.tsx`, `login/page.tsx`, `magazine-form.tsx`.

**Execution note:** Before starting, re-run the raw-token grep across `app/` to refresh the file set — the list above was built from a manual grep pass and is a checklist, not a closed inventory. Prefer a scripted global substitution for the unambiguous 1:1 KTD-3 rows (including `/NN` opacity suffixes and the three arbitrary radius forms), reserving manual edits for the per-use `text-blaze` → `text-primary` vs `text-accent-foreground` judgment; hand-editing this volume risks missing an individual occurrence within an otherwise-migrated file.

**Execution note:** Value-preserving; verify via U6 grep-gate + visual review.

**Patterns to follow:** KTD-3 mapping table; mirror U1's replacements exactly.

**Test scenarios:** `Test expectation: none -- value-preserving CSS-class rename.`

**Verification:** No raw token utility classes remain in `app/**` route components; routes render identically on both themes.

---

### U3. Migrate `app/globals.css` internal `var()` references and reconcile the radius scale

**Goal:** The stylesheet's own base layer and keyframes reference raw tokens directly; migrate them to canonical/extended names, and confirm the radius scale anchors `rounded-lg` at 0.625rem.

**Requirements:** Issue task 1 (globals.css side), task 3 (radius scale).

**Dependencies:** none (independent of U1/U2).

**Files:** `app/globals.css`.

**Approach:** Migrate the base-layer `var()` refs: `* { border-color: var(--line) }` → `var(--border)`; `body { background: var(--paper); color: var(--ink) }` → `var(--background)` / `var(--foreground)`; `:focus-visible { outline: … var(--blaze) }` → `var(--ring)` (shadcn's dedicated focus-indicator token, per KTD-3 — not `--primary`, so a later theme pass can tune the ring independently of primary-action fills); the `arm-row` `@keyframes` (`var(--blaze-soft)`, `var(--blaze)`) → `var(--accent)` / `var(--primary)`. Confirm the `@theme inline` radius scale keeps `--radius-lg` → 0.625rem so `rounded-lg` matches the pre-migration frame radius. **Do not** delete the raw token definitions or the bridge yet — that is U4, gated on consumers being clean.

**Execution note:** These in-stylesheet refs are invisible to a component-file grep — they must be migrated here explicitly or they dangle when U4 deletes the raw tokens.

**Test scenarios:** `Test expectation: none -- CSS internal reference rename; visual review covers it.`

**Verification:** `app/globals.css` base layer + keyframes reference only shadcn-canonical/extended tokens; page background, body text, focus ring, and row-flash animation render identically on both themes.

---

### U4. Collapse token definitions and delete the bridge

**Goal:** Define theme values **directly** under shadcn-canonical names (KTD-2) and the extended custom names (KTD-1), delete the `shadcn/ui token bridge (TEMPORARY)` alias `:root` block and the now-unreferenced raw token definitions, and prune `@theme inline` to canonical + extended `--color-*` only.

**Requirements:** Issue task 1 (rename vars, keep values), task 4 (delete bridge block).

**Dependencies:** U1, U2, U3 — every consumer (components, routes, and the stylesheet's own refs) must be on shadcn/extended names before the raw definitions are removed.

**Files:** `app/globals.css`.

**Approach:** In `:root,[data-theme="dark"]` and `[data-theme="light"]`, replace raw token names with their canonical shadcn names carrying the **same hex values** (dark + light preserved verbatim). Add the full canonical set including currently-unused `--secondary`, `--secondary-foreground`, `--card-foreground`, `--popover`, `--popover-foreground` (KTD-2). Keep `--ink-soft`, `--steel`, `--ok`, `--danger-soft` defined directly with their values. Delete the entire `:root { --background: var(--paper); … }` bridge alias block (globals.css lines ~85–113). In `@theme inline`, keep `--color-*` mappings for canonical + extended tokens; drop mappings for deleted raw names. Preserve non-color tokens (`--shadow-raised`, `--shadow-pop`, `--glow-blaze`, `--z-*`, radius scale, fonts).

**Execution note:** **Verification-first.** Run the consumer grep-gate (KTD-4) across `app/` + `components/` and confirm zero old-token matches *before* deleting the raw definitions. Delete only when clean — a missed consumer becomes a silent no-op utility after this unit.

**Test scenarios:** `Test expectation: none -- value-preserving token-definition rewrite; covered by U6 grep-gate + full-app visual/contrast review on both themes.`

**Verification:** No raw definitions remain in `app/globals.css` for the full retired set — `--paper`, `--paper-raised`, `--paper-sunken`, `--ink`, `--ink-faint`, `--line`, `--line-strong`, `--blaze`, `--blaze-ink`, `--blaze-soft`, `--danger` — and no bridge alias block remains; every shadcn-canonical + extended token is defined directly with correct dark/light values; app builds and renders identically on both themes.

---

### U5. Update DESIGN.md token spec

**Goal:** Bring the DESIGN.md token spec into line with the shadcn-first token model.

**Requirements:** Issue task 1 (DESIGN.md token names).

**Dependencies:** U4 (canonical names finalized).

**Files:** `DESIGN.md`.

**Important — DESIGN.md's key names differ from the CSS var names.** DESIGN.md's `colors:` block names the accent family `anodized` / `anodized-ink` / `anodized-soft` (NOT `blaze`), and its `components:` block templates values via `{colors.X}` references (e.g. `{colors.anodized}`, `{colors.paper-raised}`, `{colors.ink}` — ~6 references). A blind "rename to shadcn names" would (a) miss the `anodized*` family entirely since there is no `blaze` key to find, and (b) leave every `{colors.X}` template reference dangling — the same silent-no-op failure KTD-4 guards against in CSS, recurring in YAML where there is no grep-gate.

**Approach:** Apply the KTD-3 mapping to DESIGN.md's `colors:` keys **including the accent family under its DESIGN.md name**: `anodized` → `primary`, `anodized-ink` → `primary-foreground`, `anodized-soft` → `accent`; plus `paper` → `background`, `paper-raised` → `card`, `paper-sunken` → `muted`, `ink` → `foreground`, `ink-faint` → `muted-foreground`, `line` → `border`, `line-strong` → `input`. Keep extended tokens (`ink-soft`, `steel`, `ok`, `danger-soft`) under their existing names. **Update every `{colors.X}` template reference in the `components:` block in lockstep** so no reference dangles. Add a one-line note that the system uses shadcn-canonical semantic tokens plus a small set of directly-defined extensions. Keep the AA contrast notes and prose (which uses "anodized" as a *material/brand* descriptor, not a token name — leave prose usages) intact.

**Execution note:** After editing, grep DESIGN.md for `{colors.` and confirm every referenced key still exists in the updated `colors:` block — this is the DESIGN.md analog of the U6 grep-gate, since U6's scope excludes DESIGN.md.

**Test scenarios:** `Test expectation: none -- documentation.`

**Verification:** DESIGN.md `colors:` keys and all `{colors.X}` template references match `app/globals.css` token names; no dangling `{colors.X}` reference; extended tokens documented as intentional extensions; AA notes and brand prose preserved.

---

### U6. Verification grep-gate and both-theme visual review

**Goal:** Prove no dangling references remain and both themes still pass, then run the full CI gate.

**Requirements:** Issue task 5 (contrast/visual review both themes); closes KTD-4.

**Dependencies:** U1–U5.

**Files:** none (verification only).

**Approach:**
1. **Grep-gate (must be empty).** Across `app/`, `components/`, and `app/globals.css`, search for every retired form:
   - Utility classes: `\b(bg|text|border|ring|fill|stroke)-(paper|paper-raised|paper-sunken|ink|ink-faint|line|line-strong|blaze|blaze-ink|blaze-soft|danger)\b` — including `/NN` opacity variants.
   - CSS var names: `var\(--(paper|paper-raised|paper-sunken|ink|ink-faint|line|line-strong|blaze|blaze-ink|blaze-soft|danger)\)` and any leftover `--paper`/`--ink`/… *definitions*.
   - Arbitrary radius: `rounded-\[var\(--radius(-lg)?\)\]`, `rounded-\[calc\(var\(--radius\)`.
   - **Note:** extended tokens `ink-soft`, `steel`, `ok`, `danger-soft` are expected to remain — exclude them from the gate.
   - **DESIGN.md (separate check — outside the three grep scopes above):** grep `DESIGN.md` for `{colors.` and confirm every referenced key exists in the updated `colors:` block (no dangling template refs), and that the `colors:` keys match `app/globals.css` token names (U5).
2. **Visual/contrast review** both themes (dark "Field Console" + light "Machined Instrument"): key surfaces — app shell/nav, data tables (incl. row-flash `arm-row` animation), forms, buttons, toasts, dialogs, login, empty/feedback states. Confirm AA contrast per DESIGN.md notes (values are unchanged, so this is a no-drift confirmation).
3. **`just ci-check`** (lint, format-check, typecheck, pre-commit, test, test-e2e) — must pass. Per AGENTS.md this is a hard pre-commit gate.

**Test scenarios:**
- Grep-gate returns zero matches for every retired form across all three scopes.
- Both themes render the reviewed surfaces with no missing backgrounds/borders/text (a silently-dropped utility shows as an unstyled element).
- `just ci-check` exits 0.

**Verification:** Grep-gate clean, both themes visually confirmed, `just ci-check` green.

---

## Scope Boundaries

**In scope:** token vocabulary collapse, consumer migration, bridge deletion, radius reconciliation, DESIGN.md update, both-theme verification.

**Non-goals:** changing any rendered value; adding shadcn components; visual restyling.

### Deferred to Follow-Up Work

- Renaming extended tokens to shadcn-idiomatic names (`ok → success`, `steel → info`) — deliberately out of scope to avoid churn beyond the issue (A1).
- Normalizing `bg-[var(--ok)]` arbitrary forms to `bg-ok` utilities — optional cleanup, may fold into U1/U2 if trivial, otherwise defer.

---

## Risks & Dependencies

- **Silent no-op utilities (primary risk).** Tailwind v4 emits nothing for an unknown utility — a missed consumer produces an unstyled element, not a build error. Mitigated by the U6 grep-gate and U4's verification-first delete.
- **In-stylesheet `var()` refs missed by component grep.** Mitigated by dedicating U3 to globals.css internal refs before U4 deletes the raw tokens.
- **Opacity + arbitrary forms slipping the gate.** Mitigated by explicitly enumerating `/NN` and `[var(--…)]` forms in both migration units and the U6 gate.
- **Dependency:** U4 hard-depends on U1–U3; U6 depends on all.

---

## Verification Contract

- Grep-gate: zero matches for all retired token names/utilities (incl. opacity + arbitrary + var() forms) across `app/`, `components/`, `app/globals.css`; extended tokens excluded.
- Both themes (dark + light) pass visual/contrast review on all key surfaces with no missing styles.
- `just ci-check` passes (mandatory pre-commit gate).

## Definition of Done

- [ ] All `components/ui/**` and `app/**` consumers use shadcn-canonical utilities (U1, U2).
- [ ] Arbitrary radius forms migrated (U1, U2) and `app/globals.css` internal refs + radius scale confirmed (U3).
- [ ] shadcn-canonical + extended tokens defined directly with dark/light values; bridge block deleted (U4).
- [ ] DESIGN.md token spec updated (U5).
- [ ] Grep-gate clean, both themes verified, `just ci-check` green (U6).

---

## Sources & Research

- GitHub issue #47 (origin).
- `app/globals.css` — current bridge block (lines ~85–161), theme definitions, base layer + `arm-row` keyframes.
- `DESIGN.md` — token spec (names + hex + AA contrast notes).
- Usage inventory (grep): ~28 files touch retired raw tokens (approximate — the per-unit `Files` lists are a starting checklist, not a closed set; the U6 grep-gate is the authoritative completeness check). Frequency-ranked utilities (`text-ink` 39, `text-ink-soft` 25, `border-line` 19, `bg-paper-sunken`/`bg-paper-raised` 15 each, …); opacity variants (`bg-paper-sunken/50`, `border-danger/40`) and arbitrary `var()`/radius forms confirmed present; `focus:border-blaze` present in `input.tsx`/`select.tsx`, `border-blaze/30` in `feedback.tsx`.
- Project memory: [[shadcn-first-kiss]] — shadcn-first, KISS, idiomatic library components.
