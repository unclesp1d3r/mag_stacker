# Residual Review Findings

Branch: `20-render-magazine-label-as-a-magpul-paint-pen-dot-matrix-in-the-detail-view`
Plan: `docs/plans/2026-08-02-001-feat-magazine-dot-matrix-label-plan.md`
Source: `ce-code-review` (7 reviewers) + `ce-simplify-code` (3 reviewers), 2026-08-02.

These are the findings that were **not** applied at the time of each review. Everything else landed
in commits `85f2575` (simplification) and `83cc002` (review fixes). No tracker tickets were filed;
this committed record is the durable sink.

The sections below are in the order they were written, so this file reads as a history rather than a
snapshot. Most of the early findings converged on one thing — **the glyph table shipped empty, so the
render path had no production or test exercise at all** — and were closed once the font was
transcribed and the verification work landed on `glyph-font-verification`. Each is marked below.
**Jump to "Still open" for what actually remains.**

---

## Not applied

- ~~**P1 — The ships-dark e2e cannot tell "suppressed" from "unwired".**~~ **RESOLVED** — AE1 now asserts the drawn dot pattern, so removing the component fails the spec.
  Original finding: `e2e/magazine-dot-matrix.spec.ts:94`
  (adversarial, advisory, owner: human)

  The only matrix-specific assertion is `getByRole("img", { name: /Dot pattern to paint/ })` having
  count 0. `DotMatrixLabel` returns `null` in the hidden case, so there is no DOM difference between
  "the component ran and correctly resolved to hidden" and "the component was never invoked". Deleting
  the `<DotMatrixLabel />` line from `magazine-detail-view.tsx` leaves this spec fully green. Until the
  font lands there is no positive signal to assert against, which is why it was not fixed here — but it
  means a wiring regression between now and the transcription PR would ship silently, and this spec is
  exactly the safety net that PR will lean on.

- ~~**P2 — The rendered output is entirely unverified.**~~ **RESOLVED** — see the post-transcription section below.
  Original finding: `app/(app)/magazines/dot-matrix-label.tsx`
  (adversarial + correctness testing gaps, owner: human)

  No test at any level exercises the component's markup: the SVG geometry, the per-dot keys, the
  `unrepresentable` branch, or the `cellCountVerified` caveat branch. `buildAriaLabel` and
  `buildDoesNotFitMessage` are never called by a test. `resolveDotMatrix` underneath is covered
  exhaustively against synthetic fixtures, so the gap is precisely the translation from result to
  markup — new, unexercised surface the moment the real table ships. This is the same gap that let the
  canvas-width bug (fixed in `83cc002`) sit unnoticed through implementation.

  Related: AE8/R13's accessible-name wording, R4's caveat text, and R9's message text are asserted
  nowhere. The plan's own Verification Contract already records these three as unverified.

- **P3 — `glyphs.ts` throws at module load with no runtime fallback.** `src/domain/magazines/glyphs.ts:105`
  (adversarial, advisory, owner: human)

  `MAGPUL_GLYPHS` is parsed at import time and this module is reachable from the magazine detail route,
  so a malformed fixture hard-crashes that route rather than degrading to "dot matrix unavailable".
  Currently well-guarded: `glyphs.test.ts` asserts the shipped fixture parses, and `just ci-check` gates
  every commit. Exposure requires a hand-edit that bypasses CI. Left as-is because fail-loud on a
  corrupt font is the right default for a feature whose whole job is telling someone what to paint
  permanently onto hardware.

- **P3 — The shared overflow fixture is weaker than the check it was extracted from.**
  `e2e/fixtures/overflow.ts` (adversarial residual, owner: human)

  `expectNoHorizontalOverflow` asserts `scrollWidth <= clientWidth + 1`. `responsive-overflow.spec.ts`
  additionally probes `maxScrollX` for real scrollability, and kept its own inline version because
  swapping in the shared helper would have split one `page.evaluate` into two. A future spec adopting
  the shared helper on the assumption of parity would get the weaker guarantee.

## Deferred to the repo owner (from PR #90 review)

- ~~**`unrepresentable` conflates "unsupported character" with "too long".**~~ **RESOLVED** — the
  `reason` discriminant landed, and the underlying product question was settled by dropping
  unpaintable characters instead. See "Hyphen question" below.

- **`src/data/calibers.txt` and `manufacturers.txt` have the same untested drift** that PR #90 fixed for the
  glyph fixture. `reference.test.ts` asserts against the caches parsed from `raw.ts` and never reads the
  `.txt` files, so editing one and forgetting to regenerate would pass CI while production used the stale
  embedded string. Left alone as out of scope; the glyph fixture now has the pattern to copy.

## From the post-transcription review (commit `aa47489`) — now resolved

Two reviewers (code-quality, test-coverage) over the increment that transcribed the glyph font and
turned the feature on. No functional bugs. Everything they raised has since been closed on
`glyph-font-verification`:

- **The glyph font was 34/36 unverified.** `glyphs.test.ts` now asserts all 36 against
  `EXPECTED_GLYPHS`, an independently-recorded table written in Magpul's own sheet ordering
  (digits `1`-`9` then `0`) rather than the fixture's, so a regeneration that shifts rows cannot
  pass by matching the artifact it was derived from. A companion test asserts the expected table
  itself still covers all 36 characters, so deleting a row from it cannot quietly shrink the guard.
  Verified by corrupting a single dot in glyph `G` and confirming two tests go red.

- **`resolveDotMatrix` was never exercised against the real `MAGPUL_GLYPHS`.** A second describe
  block re-runs the acceptance examples against the shipped font. This immediately proved its own
  worth: AE4 (`AR-X`) takes a *different path* under the two tables — the synthetic fixture has a
  hyphen, so it overflows; the real font does not, so the hyphen drops and the remaining `ARX`
  overflows. Same verdict, different rule.

- **R4/R9 message text was asserted nowhere.** New `dot-matrix-messages.test.ts` covers every
  exported string and both composition branches; the e2e now asserts R4's caveat and R9's
  does-not-fit message as *rendered* text.

- **Nothing inspected rendered SVG dot positions.** AE1's e2e now reads the `r` attribute off every
  circle and compares the whole 60-dot pattern against an expected string restated from Magpul's
  sheet. This is the only assertion anywhere that spans fixture file -> parser -> resolver ->
  geometry.

- **Stale "feature is off" comments** in `dot-matrix-label.tsx`, `glyphs.ts`, `dot-matrix.ts`, the
  resolver test header, and plan U1 are corrected.

Also closed from the earlier lists above: the P1 "ships-dark e2e cannot tell suppressed from
unwired" (AE1 now positively asserts drawn dots, so deleting the `<DotMatrixLabel />` line fails),
and the P2 "rendered output entirely unverified".

## Hyphen question — resolved by dropping, not by rejecting

The parked CodeRabbit finding (`unrepresentable` conflating "unsupported character" with "too long")
and the open hyphen product question turned out to be the same question, and the owner resolved both
in one direction: **a character with no glyph is dropped from the pattern, not fatal to it** (R9a).

The reasoning that settled it: R8 already drops characters — `US04` on a 2-cell GL9 paints `04` and
discards `US` — so "the painted mark differs from the stored label" was established behavior, and
refusing to paint `A-1` over one hyphen while happily painting `04` for `US04` was the inconsistent
position. Magpul's floorplate has no hyphen cell, so a hyphen is unpaintable as physical fact, which
is the same class of constraint that justifies R8. The collision risk (`A-1` and `A1` paint alike)
already exists under R8 (`US04` and `XY04` both paint `04`).

Rejected: narrowing #21's allowed character set to remove the hyphen, which would invalidate stored
labels and need a migration.

`unrepresentable` still gained the `reason` discriminant, because it is still reachable — a label
with *nothing* paintable in it (`--`) has no pattern to offer — and that case gets its own message
rather than the false "does not fit".

## Still open

- **Per-model cell counts.** `MODEL_CELL_COUNTS` carries only the GL9 and LR/SR seeds; everything
  else renders under R4's unverified 4-cell fallback. This is now the largest unverified area in the
  feature, and the plan's Verification Contract says so. A count added without a physical or
  cross-checked source would render as though confirmed — worse than an unrecognized model, since
  the caveat only attaches to misses.

- **`src/data/calibers.txt` and `manufacturers.txt` have the same untested drift** the glyph fixture
  had before PR #90 fixed it. `reference.test.ts` asserts against the caches parsed from `raw.ts` and
  never reads the `.txt` files. Out of scope here; the glyph fixture now has the pattern to copy.

- **The shared overflow fixture is weaker than the check it was extracted from** (`e2e/fixtures/overflow.ts`),
  unchanged from the earlier list above.

## Checked and cleared

Recorded so a later reader does not re-derive them:

- **Security: no findings.** The authorization gate in `getMagazine` still runs strictly before both the
  owner lookup and `attachCompatibility`, including after the `Promise.all` refactor. `NotFoundError`
  semantics are preserved, so the 404 path stays indistinguishable. No injection path — only `<circle>`
  elements derive from the label, and the one string reaching markup goes through a React-escaped
  attribute.
- **Exposing the owner's `magpulMode` to a grantee** is deliberate, not a leak: R6 requires rendering
  against the owner's setting, and the flag was already indirectly observable before this change.
- **Cross-brand token collision** was the P1 fixed in `83cc002`. The residual risk is that a *future*
  addition to `MODEL_CELL_COUNTS` could reintroduce it with a token that is a substring of some other
  product line. The list now carries a comment banning caliber tokens for this reason.
