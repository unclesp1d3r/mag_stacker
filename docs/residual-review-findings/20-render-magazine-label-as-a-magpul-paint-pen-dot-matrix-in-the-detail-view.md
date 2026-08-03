# Residual Review Findings

Branch: `20-render-magazine-label-as-a-magpul-paint-pen-dot-matrix-in-the-detail-view`
Plan: `docs/plans/2026-08-02-001-feat-magazine-dot-matrix-label-plan.md`
Source: `ce-code-review` (7 reviewers) + `ce-simplify-code` (3 reviewers), 2026-08-02.

These are the findings that were **not** applied. Everything else the review surfaced landed in
commits `85f2575` (simplification) and `83cc002` (review fixes). No tracker tickets were filed;
this committed record is the durable sink.

Almost all of it converges on one thing: **the glyph table ships empty, so the render path has no
production or test exercise at all.** These items become both testable and worth revisiting in the
same follow-up that transcribes Magpul's diagram.

---

## Not applied

- **P1 — The ships-dark e2e cannot tell "suppressed" from "unwired".** `e2e/magazine-dot-matrix.spec.ts:94`
  (adversarial, advisory, owner: human)

  The only matrix-specific assertion is `getByRole("img", { name: /Dot pattern to paint/ })` having
  count 0. `DotMatrixLabel` returns `null` in the hidden case, so there is no DOM difference between
  "the component ran and correctly resolved to hidden" and "the component was never invoked". Deleting
  the `<DotMatrixLabel />` line from `magazine-detail-view.tsx` leaves this spec fully green. Until the
  font lands there is no positive signal to assert against, which is why it was not fixed here — but it
  means a wiring regression between now and the transcription PR would ship silently, and this spec is
  exactly the safety net that PR will lean on.

- **P2 — The rendered output is entirely unverified.** `app/(app)/magazines/dot-matrix-label.tsx`
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

- **`unrepresentable` conflates "unsupported character" with "too long".** `src/domain/magazines/dot-matrix.ts`
  (CodeRabbit, PR #90, owner: human)

  The `unrepresentable` variant carries only `cellCount` and `cellCountVerified`, so the resolver returns the
  same shape whether the label overflows the floorplate or merely contains a character outside the glyph
  table. The view then always renders "This label does not fit this magazine's floorplate" — factually wrong
  for a short label that fails only on font coverage, which is exactly AE5 (`A.1` on a 4-cell PMAG).

  **Not fixed autonomously**, because the message is specified product behavior: R9 and AE5 both define a
  single message for both causes. Changing it is a product-copy decision.

  Recommendation: add `reason: "unsupportedCharacter" | "doesNotFit"` to the `unrepresentable` variant, give
  the unsupported-character case its own message, and amend R9/AE5 to match. The discriminant was **not**
  added preemptively — with the message unchanged it would have no consumer.

  Nothing is user-visible yet: the empty glyph table short-circuits to `hidden` first, so this surfaces only
  once the font is transcribed.

- **`src/data/calibers.txt` and `manufacturers.txt` have the same untested drift** that PR #90 fixed for the
  glyph fixture. `reference.test.ts` asserts against the caches parsed from `raw.ts` and never reads the
  `.txt` files, so editing one and forgetting to regenerate would pass CI while production used the stale
  embedded string. Left alone as out of scope; the glyph fixture now has the pattern to copy.

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
