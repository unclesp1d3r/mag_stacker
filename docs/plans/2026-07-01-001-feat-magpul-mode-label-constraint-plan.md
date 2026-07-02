---
title: Magpul Mode Label Constraint - Plan
type: feat
date: 2026-07-01
topic: magpul-mode-label-constraint
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Magpul Mode Label Constraint - Plan

## Goal Capsule

- **Objective:** Add an opt-in, per-account **Magpul mode** that constrains a magazine's `label` to the PMAG Gen M3 dot-matrix character set when enabled, and leaves labels as free text when disabled. Enforcement is a UX/domain-layer function, not a database constraint.
- **Product authority:** Decisions below were confirmed with the requester during brainstorm and hardened by a `ce-doc-review` pass; treat them as pinned unless planning surfaces a conflict.
- **Open blockers:** None. The two prior open items are resolved: the flag is stored as a Better Auth `additionalFields` boolean on `user` (KTD-1), and the **owner's** mode governs (Key Decision, R3).
- **Product Contract preservation:** Product Contract changed during the review pass (R2/R3/R6/R7/R9/R10/R11 clarified; owner's-mode and grandfather-on-edit decisions added; AE7–AE10 added) — all user-approved via `ce-doc-review`. Planning below adds only the HOW; it does not alter product scope.

---

## Product Contract

### Summary

Introduce a per-account **Magpul mode** profile toggle (default off). When on, a magazine `label` must fit what a Magpul PMAG Gen M3 floorplate can physically hold — up to 4 characters from `A-Z`, `0-9`, and `-` — enforced through a form input mask plus domain validation. When off, labels stay unrestricted free text with no rendering. This issue owns the shared mode flag and character-set/length constants that #20 (dot-matrix rendering) and #22 (label prefixes / auto-numbering) build on.

### Problem Frame

`magazine.label` is free text today. Issue #20 renders the label as a Magpul paint-pen dot matrix, whose glyph font only covers `A-Z`, `0-9`, and `-` on a fixed grid — so a rendered label can only represent that set, and only a few characters fit the floorplate. The original issue #21 proposed constraining every label to that set with a database `check` backstop.

That over-generalizes. Not every owner marks magazines with a PMAG M3 dot matrix; some stencil or spray-paint arbitrary identifiers and have no reason to accept a 4-character alphanumeric limit. A global restriction (and a table-level DB constraint) would wrongly punish those owners. The constraint is only meaningful for owners who opt into the Magpul dot-matrix workflow, so it belongs behind a per-account switch, enforced where the user actually types — not at the storage layer.

### Key Decisions

- **Opt-in per account, not global.** The dot-matrix constraint (and, in #20, the rendering) applies only when Magpul mode is on. Owners who paint arbitrary labels are unaffected.
- **Owner's mode governs.** Label validation keys on the **magazine owner's** Magpul mode, not the editor's — the label describes the owner's physical magazine. Under grant-based sharing, a grantee editing an owner's mode-on magazine sees the constraint (with copy explaining it, per R9) even if the grantee's own mode is off; a grantee's own mode never relaxes an owner's constraint.
- **UX/domain enforcement, not the database.** Enforcement lives in the domain layer (conditioned on the owner's mode) and the form. A table-level `CHECK` genuinely can't express this — it can't consult the owner's per-account flag. A `BEFORE INSERT/UPDATE` trigger technically could, by joining the user record, but we deliberately reject that for the cross-table coupling and operational complexity it adds: this is a UX/validation feature, not a storage invariant. No DB backstop mirrors the rule, dropping #21's original DB `check`.
- **Layered enforcement.** A form input mask is the first line (prevents most invalid input from being submitted); domain validation is authoritative (catches paste, API, and programmatic paths); there is no third database layer.
- **Reject, don't auto-clean.** After normalization, invalid input is rejected with a clear message rather than silently stripped or truncated, so a saved label always matches what the user meant.
- **Grandfather existing labels on edit.** When mode is on and the form opens a magazine whose stored label doesn't conform, the field shows the stored value verbatim; the mask and the rejection error do not fire until the user edits the field, and the record can be saved unchanged. The constraint governs new label *input*, not pre-existing values (see R11, AE7).
- **Max length is 4, fixed by the hardware.** The PMAG Gen M3 floorplate carries 4 dot cells (4 sets of a 3×5 grid), so `MAX_LABEL_LENGTH = 4` — per Magpul's published PMAG Gen M3 dot-matrix diagram, with the hyphen occupying one cell like any glyph. Exact glyph geometry is #20's concern.
- **No retroactive rewrite; truncate the render, not the record.** Enabling Magpul mode never touches existing labels and never forces correction of nonconforming ones. The stored value is preserved verbatim. Display handling of a nonconforming stored label — truncating the rendered dot matrix to what fits — is #20's responsibility; this plan records it as an input constraint for #20, not a contract owned here.
- **Alternatives considered.** A per-magazine "marking type" flag (constraint as a property of each magazine) and an always-render-with-warnings approach (no hard limit) were weighed. Rejected in favor of a per-account opt-in: an owner either works the PMAG dot-matrix way or doesn't, and opt-in signals intent for hard enforcement. Revisit if a second per-account setting appears or if mixed per-magazine marking becomes a real need.

### Requirements

**Profile setting**

- R1. A per-account **Magpul mode** boolean defaults to off. It is conceptually a profile setting; its physical storage is a planning decision (see Outstanding Questions).
- R2. A user can toggle their own Magpul mode, and it governs validation and masking for the magazines they own.

**Label constraint when Magpul mode is on**

- R3. When the magazine **owner's** Magpul mode is on, a `label` is valid only if, after normalization, it contains solely `A-Z`, `0-9`, and `-` and is at most `MAX_LABEL_LENGTH` (4) characters. An empty label stays valid.
- R4. Normalization uppercases the input and trims outer whitespace before validation.
- R5. Input still invalid after normalization — unsupported characters, internal spaces, or more than 4 characters — is rejected with a clear, user-facing message naming the allowed set and the max length. It is never silently stripped or truncated.
- R6. The allowed character set and the max length are declared once as shared named constants. This validator and the magazine form consume them; #20's renderer and #22's numbering will import the same constants when built, so all surfaces stay in agreement. No export surface is designed now for those unbuilt consumers — they import what exists.

**Enforcement surfaces**

- R7. When the magazine owner's Magpul mode is on, the form applies a live input mask: it uppercases as the user types, filters keystrokes to the allowed set, and caps length at 4 — so most invalid input never reaches submit. The mask is an affordance; R5 domain validation remains authoritative for paste and non-form paths.
- R8. Enforcement is UX/domain-layer only. No database `check` constraint mirrors this rule.
- R9. The form surfaces the rule accessibly: helper text naming the allowed set and limit is visible the whole time the constraint is active (not only on error); on rejection, the input is marked invalid and its error message is programmatically associated with the input and announced; characters the mask silently drops are announced via a live region so non-visual users learn the constraint. When a grantee edits an owner's mode-on magazine, the helper copy explains the constraint comes from the owner's setting. Targeted via ARIA roles and accessible names, no `data-testid`.

**Behavior when Magpul mode is off**

- R10. When the magazine owner's Magpul mode is off, `label` is unrestricted free text (current behavior): no charset restriction, no length cap, no input mask, no dot-matrix rendering.
- R11. Enabling Magpul mode does not retroactively rewrite existing labels and does not force correction of nonconforming ones; the stored value is preserved as-is. When mode is on and the edit form opens a magazine with a nonconforming stored label, the field shows that value verbatim and the mask/error stay dormant until the user edits the field, so the record can be saved unchanged (see AE7). Truncating the *rendered* dot matrix to what the matrix can represent is #20's responsibility — recorded here as an input constraint for #20, not a contract owned by this plan.

### Acceptance Examples

- AE1. **Covers R3, R4, R7.** Given Magpul mode on, when the user types `ar-1`, the form displays `AR-1` and saves `AR-1`.
- AE2. **Covers R5.** Given Magpul mode on, when a 6-character value like `AR-15X` reaches the domain layer (e.g., via paste past the mask or an API call), it is rejected with a message naming the 4-character limit.
- AE3. **Covers R5.** Given Magpul mode on, when `A.1` is submitted (a `.` survives uppercase/trim), it is rejected with a message naming the allowed set `A-Z`, `0-9`, `-`.
- AE4. **Covers R3, R10.** An empty label is accepted whether Magpul mode is on or off.
- AE5. **Covers R10.** Given Magpul mode off, a label like `My Rifle #1` is saved unchanged.
- AE6. **Covers R11.** Given a magazine labeled `range gun` and the owner then enables Magpul mode, the stored label stays `range gun`; the detail view renders only the portion the matrix can represent (up to 4 supported glyphs), and nothing forces the owner to change the record.
- AE7. **Covers R11.** Given the owner's mode is on and a magazine's stored label is `range gun`, when the owner opens the edit form, the label field shows `range gun` verbatim with no error; the record can be saved unchanged. Only once the owner edits the label field do the mask and the R5 rejection apply.
- AE8. **Covers R1.** Given a new account (mode defaults off), when the owner adds or edits a magazine, the label field applies no mask and accepts free text.
- AE9. **Covers R2, R3, R7.** Given an owner who turns their Magpul mode on, the next label edit on a magazine they own is masked and validated against the allowed set and 4-character limit.
- AE10. **Covers R3 (owner's mode governs).** Given an owner with mode on and a grantee whose own mode is off, when the grantee edits the owner's magazine, the label is still constrained to the allowed set and limit, and the form explains the constraint comes from the owner's setting.

### Scope Boundaries

- The dot-matrix SVG rendering and its glyph font (#20). This plan defines the shared mode flag and the character-set/length constants #20 reads, but not the renderer itself. The record-preservation guarantee (R11) is surfaced as an input constraint *for* #20, not a contract owned or gated here — see Dependencies.
- Label prefixes and auto-numbering (#22).
- Floorplate variants other than PMAG Gen M3, and per-glyph grid geometry.
- Any non-ASCII or localized extension of the allowed character set.

### Dependencies / Assumptions

- **No profile-settings surface exists today.** The `user` table (`src/db/auth-schema.ts`) is Better Auth-managed and there is no user-preferences store. Magpul mode is the app's first per-account profile option; its storage shape is a planning decision (see Outstanding Questions).
- **`MAX_LABEL_LENGTH = 4`** derives from the PMAG Gen M3 floorplate (4 dot cells). The value and the allowed set are shared constants with #20 and #22.
- **Existing validation pattern.** `src/domain/magazines/validate.ts` returns all failure codes together in a single pass (the aggregate-failure-codes convention already used there); the label rule is expected to extend that surface, conditioned on the governing mode.
- **Cross-issue dependency (→ #20).** #20's renderer must honor R11: never rewrite the stored label, and truncate the *rendered* dot matrix to the 4-cell capacity for nonconforming stored values. This plan states the constraint; #20 owns implementing and gating it.

### Outstanding Questions

**Deferred to planning**

- Exact wording of the helper text and the rejection error message. (Storage location is resolved by KTD-1: a Better Auth `additionalFields` boolean on `user`.)

**Deferred to follow-up work**

- When a user enables Magpul mode, proactively surfacing a count or list of their existing nonconforming labels (a discovery aid so they can update them). Out of scope here; R11 already guarantees nothing breaks without it.

---

## Planning Contract

### Key Technical Decisions

- KTD-1. **Store `magpulMode` as a Better Auth `additionalFields` boolean on `user` (default `false`), not a separate settings table.** The admin plugin already added custom columns (`role`, `banned`, …) to the generated `user` table, so the pattern is proven; the flag then rides the session for the common self-edit path with no extra query. A dedicated `user_settings` table would add a join and a table for one bit. `auth-schema.ts` is CLI-generated — the column is added by declaring the field in `auth.ts` and re-running `bun x @better-auth/cli generate`, then `bun run db:generate` + `db:migrate`. Revisit the table if a second per-account setting appears.
- KTD-2. **Owner's mode is resolved server-side and passed into the pure validator.** `validateMagazine` stays pure: it receives an `ownerMagpulMode` boolean (and the candidate label) as context, never fetches. The service resolves the owner (already does, via `resolveCreateOwner` / `authorizeUpdate`) and reads that owner's `magpulMode` inside the same transaction before validating — so create-on-behalf keys on the **owner's** flag, not the actor's (AE10). Unit tests pass the boolean directly; integration tests exercise the real lookup.
- KTD-3. **Grandfather is enforced by change-detection, not a mode carve-out.** On update, the label rule fires only when the submitted label **differs** from the stored value; an unchanged (possibly nonconforming) label saves untouched (R11, AE7). On create, any nonempty label is new and validates. This is the single rule behind both the domain behavior and the form's "don't mask/error until edited" affordance.
- KTD-4. **Normalization lives in the service's `scalarFields`, not the validator.** The validator uppercases+trims only to run its checks (keeping it pure/read-only, matching the existing `brandModel.trim()` convention). The stored value is normalized (uppercase + outer-trim) in `scalarFields` when the owner's mode is on and the label is being set; when mode is off the raw value is stored. Nothing is stripped or truncated — invalid input is rejected upstream (R5).
- KTD-5. **New failure codes extend the existing aggregate-codes array in parity order.** Add `invalidMagpulLabel` and `magpulLabelTooLong` to `MagazineValidationCode` and to `VALIDATION_MESSAGES`, placed in the intentional code order the multi-failure test pins. The bulk-add path passes no single-label context, so its behavior is unchanged (per-prefix numbering is #22's concern).
- KTD-6. **The form mask keys on the governing mode for self-owned magazines (the common case) and defers to domain validation otherwise.** The mask is an affordance (R7); when the owning user's flag isn't readily available client-side (a shared magazine), the domain layer remains authoritative and rejects. This avoids threading per-magazine owner lookups through the list RSC for an affordance.

### Assumptions

- The magazines list/form is primarily used by owners on their own magazines; the mask affordance targets that path, with domain validation covering the rest.
- `bun x @better-auth/cli generate` regenerates `auth-schema.ts` deterministically from `auth.ts`; the generated column name is `magpul_mode` (snake_case) mapping to `magpulMode`.
- Integration tests may follow the existing `DATABASE_URL`-gated `describe`/`describe.skip` pattern; new backing-service tests use Testcontainers per `AGENTS.md`.

### Sequencing

U1 → U2 → U3 → U4, with U5 and U6 depending on U1 (and U5 on U3/U4 for the error surface). U2 is a prerequisite for U3.

---

## Implementation Units

### U1. Add `magpulMode` to the user profile + migration

- **Goal:** Persist a per-account `magpulMode` boolean (default off) and expose it on the session user.
- **Requirements:** R1; enables R2, R3.
- **Dependencies:** none.
- **Files:** `auth.ts` (declare `user.additionalFields.magpulMode`), `src/db/auth-schema.ts` (regenerated — adds `magpul_mode`), `src/db/migrations/` (new generated `.sql` + `meta/_journal.json`), `src/auth/session.ts` (extend `SessionUser` with `magpulMode`), `src/auth/__tests__/` or `src/domain/settings/__tests__/` (integration).
- **Approach:** Add `additionalFields: { magpulMode: { type: "boolean", defaultValue: false, input: false } }` to the `user` config in `auth.ts`; regenerate `auth-schema.ts` via the Better Auth CLI; `bun run db:generate` to emit the migration; extend `SessionUser` and `getCurrentUser()` to carry `magpulMode`.
- **Patterns to follow:** the admin-plugin columns already on `user`; the CLI-regen note in `src/db/schema.ts`; the lazy pool in `src/db/client.ts`.
- **Test scenarios:**
  - Integration (DATABASE_URL/Testcontainers): applying migrations creates `user.magpul_mode` with default `false`.
  - `getCurrentUser()` for a freshly seeded user returns `magpulMode: false`. Covers AE8.
- **Verification:** `bun run db:migrate` applies cleanly; typecheck passes with the extended `SessionUser`.

### U2. Shared label constants module

- **Goal:** One source of truth for the allowed set and max length.
- **Requirements:** R6.
- **Dependencies:** none.
- **Files:** `src/domain/magazines/constants.ts`.
- **Approach:** Export `MAX_LABEL_LENGTH = 4` and the allowed-charset matcher (e.g. an `A–Z 0–9 -` pattern). The validator and the form import these; #20/#22 import them when built. No export surface designed for the unbuilt consumers.
- **Test scenarios:** `Test expectation: none — pure constants, exercised via U3.`
- **Verification:** imported by U3 without duplication.

### U3. Extend domain validation for the label constraint

- **Goal:** Reject nonconforming labels when the owner's mode is on; keep the validator pure.
- **Requirements:** R3, R4, R5, R6.
- **Dependencies:** U2.
- **Files:** `src/domain/magazines/validate.ts`, `src/domain/validation-messages.ts`, `src/domain/magazines/__tests__/validate.test.ts`.
- **Approach:** Add an optional context param carrying `{ label?, ownerMagpulMode?, previousLabel? }`. When `ownerMagpulMode` is true and the label is being set/changed (KTD-3), uppercase+trim the candidate and push `invalidMagpulLabel` for out-of-set characters and `magpulLabelTooLong` beyond `MAX_LABEL_LENGTH`; empty stays valid. Codes join the existing array in parity order (KTD-5).
- **Execution note:** Implement the new codes test-first against the parity ordering example.
- **Patterns to follow:** the existing multi-code accumulation and the `firstMessage`/`messageForCode` mapping.
- **Test scenarios:** (table-driven)
  - Covers AE1/AE9. `ar-1` with mode on → no code (normalizes to `AR-1`).
  - `a1` with mode on → no code (uppercased). Empty with mode on → no code (AE4).
  - Covers AE3. `A.1` with mode on → `invalidMagpulLabel`.
  - Internal space `A B` with mode on → `invalidMagpulLabel`.
  - Covers AE2. `AR-15` (5 chars) with mode on → `magpulLabelTooLong`.
  - Mode off → any label returns no label code (AE5).
  - Multi-failure ordering test still passes with the new codes inserted.
- **Verification:** `bun test` green; new codes appear in the pinned order.

### U4. Wire owner's-mode resolution + normalization into the service

- **Goal:** Resolve the owner's mode in-transaction, validate against it, and normalize the stored label.
- **Requirements:** R3, R5, R10, R11; AE6, AE7, AE10.
- **Dependencies:** U1, U3.
- **Files:** `src/domain/magazines/service.ts`, `src/domain/magazines/__tests__/service.test.ts`.
- **Approach:** In `createMagazine`/`updateMagazine`, after resolving the owner, read that owner's `magpulMode` within the transaction and pass it (with the candidate label and, for update, the stored `previousLabel`) into `validateMagazine`. In `scalarFields`, when the owner's mode is on and the label is being set, store the normalized (uppercase + outer-trim) value; otherwise store raw (KTD-4). Update validates the label only when it differs from the stored value (KTD-3). Bulk-add passes no single-label context (unchanged).
- **Patterns to follow:** `resolveCreateOwner` / `authorizeUpdate`; the private `scalarFields` helper; the `makeMagazine` factory for seeding.
- **Test scenarios:** (integration, DATABASE_URL/Testcontainers)
  - Owner mode on: create with `AR-15` → `ValidationError` (magpulLabelTooLong); create with `ar-1` → stored `AR-1`.
  - Owner mode off: create with `My Rifle #1` → stored verbatim. Covers AE5.
  - Covers AE10. Actor is a create-on-behalf grantee with mode off, owner mode on → label still constrained.
  - Covers AE7. Update a magazine whose stored label is `range gun` (owner mode on) without changing the label → succeeds unchanged; changing it to `A.1` → rejected.
  - Update that changes only caliber leaves a nonconforming stored label intact (AE6/R11).
- **Verification:** `bun test` integration suite green against a live/Testcontainers DB.

### U5. Magazine form: input mask + accessible surfacing

- **Goal:** Apply the live mask and accessible helper/error when the governing mode is on, honoring grandfather.
- **Requirements:** R7, R9; AE1, AE7, AE9.
- **Dependencies:** U1, U3, U4.
- **Files:** `app/(app)/magazines/magazine-form.tsx`, `app/(app)/magazines/magazines-view.tsx`, `app/(app)/magazines/page.tsx`, `app/(app)/magazines/actions.ts`, `e2e/` (Playwright spec).
- **Approach:** Thread the governing `magpulMode` from the page RSC (self-owned → current user's session flag) down to the form. In the label `onChange`, when mode is on and the field has been interacted with, uppercase → filter to the allowed set → cap at 4 (plus `maxLength`). Show helper text via the existing `Field` `hint` whenever mode is on (persistent). Map `invalidMagpulLabel`/`magpulLabelTooLong` to inline errors via the existing `firstMessage`/`codes` + `role="alert"` path; associate the message with the input and announce mask-dropped keystrokes via an `aria-live` region. For a nonconforming initial value, leave the field verbatim and dormant until first edit (KTD-3, R11).
- **Patterns to follow:** the controlled-state `set()` helper and `Field`/`Input` components; `hint` usage in `firearm-form.tsx`; `firstMessage(codes, [...])` binding.
- **Test scenarios:** (Playwright e2e, Docker; target by role/label/text, no `data-testid`)
  - Covers AE1/AE9. Mode on: typing `ar 15!` yields `AR15`; save persists `AR15` (mask filtered space+`!`, capped 4 → wait: `ar 15!` → `AR15`).
  - Helper text naming the allowed set + limit is visible whenever mode is on.
  - Mode off: `My Rifle #1` accepted, no mask. Covers AE5.
  - Covers AE7. Opening an existing `range gun` magazine with mode on shows `range gun` and no error until the field is edited.
- **Verification:** `bun run test:e2e` passes for the magazine form flows.

### U6. Settings page with the Magpul mode toggle

- **Goal:** A minimal profile settings surface where the user toggles their own Magpul mode.
- **Requirements:** R1, R2; AE8, AE9.
- **Dependencies:** U1.
- **Files:** `app/(app)/settings/page.tsx`, `app/(app)/settings/settings-form.tsx`, `app/(app)/settings/actions.ts`, `app/(app)/app-shell.tsx` (nav entry), `e2e/` (Playwright spec).
- **Approach:** A single-purpose settings page (not a general framework — scope discipline) rendering the current user's `magpulMode` as a toggle. The server action updates the flag via Better Auth's `updateUser` (additionalFields are updatable) or a scoped `db` update on the acting user, then revalidates. Add a `Settings` nav entry in `app-shell.tsx`.
- **Patterns to follow:** existing `(app)` route + server-action shape; `getCurrentUser()`; `app-shell.tsx` nav list.
- **Test scenarios:**
  - Integration/server-action: toggling persists `magpulMode` for the acting user only.
  - Covers AE9 (e2e): after enabling the toggle, the next magazine label edit is masked/validated.
  - Covers AE8 (e2e): a default-off account applies no mask.
- **Verification:** toggle persists across reload; nav entry reachable; `bun run test:e2e` green.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Lint/format | `bun run lint` | all units |
| Types | `bun run typecheck` | all units |
| Unit + integration | `bun test` | U1, U3, U4, U6 (integration gates on `DATABASE_URL`) |
| Migration applies | `bun run db:migrate` | U1 |
| E2E | `bun run test:e2e` (Docker) | U5, U6 |

---

## Definition of Done

- `magpulMode` persists per account (default off), toggled from a settings page, surfaced on the session (R1, R2).
- With the **owner's** mode on, labels are constrained to `A-Z`/`0-9`/`-` and ≤4 chars, normalized (uppercase + outer-trim), and invalid input is rejected with a clear message — enforced in the domain layer and the form mask, with no DB constraint (R3–R9).
- Create-on-behalf keys on the owner's mode (AE10); mode-off is unrestricted free text (R10, AE5).
- Existing nonconforming labels are preserved and never force-corrected; unchanged saves succeed (R11, AE6, AE7).
- Shared constants back both the validator and the form (R6); `#20`/`#22` can import them.
- All acceptance examples (AE1–AE10) are covered by tests; `bun run lint`, `bun run typecheck`, `bun test`, and `bun run test:e2e` are green; the migration applies cleanly.
