---
title: "Playwright matches accessible names by substring, so name-based locators are looser than they look"
module: e2e
date: 2026-08-07
problem_type: test_failure
component: testing_framework
severity: medium
root_cause: wrong_api
resolution_type: test_fix
related_components:
  - frontend_stimulus
  - testing_framework
tags:
  - playwright
  - e2e
  - accessible-name
  - getbyrole
  - aria-label
  - false-pass
---

# Playwright matches accessible names by substring, so name-based locators are looser than they look

## Problem

`getByRole(role, { name })` matches the accessible name by **substring** unless `exact: true` is passed. In a codebase that forbids `data-testid` and therefore targets everything by accessible name, that default silently changes what a locator selects — in both directions, and without failing.

## Symptoms

Two opposite failures, both silent:

- **Too loose.** `getByRole("button", { name: "Edit" })` also matches `"Edit Piston attachment"`. Paired with `.first()`, the click lands on whichever element renders first in the DOM, so the test passes for a reason unrelated to the name it asked for. Reordering the page later moves the click with no test failure.
- **Assumed too strict.** Reasoning that a bare `"Edit"` *cannot* match `"Edit Piston attachment"` leads to the conclusion that an absence assertion (`toHaveCount(0)`) is missing coverage it in fact already had.

Neither shows up as a red test. The first passes by accident; the second produces a confident, wrong explanation of why a passing test was inadequate.

## What Didn't Work

- **Reading the locator as if it were exact.** `{ name: "Edit" }` reads like an equality check. It is a containment check, and nothing in the call site says so.
- **Accepting a review comment's stated reasoning without checking it.** An automated reviewer flagged an absence assertion as insufficient because "the exact-name assertion does not match attachment buttons." The finding produced a worthwhile change (a more explicit assertion), but its premise was backwards — the bare name already matched them. Acting on the fix while repeating the reviewer's reasoning propagated a false claim about how the suite behaved.
- **Trusting `.first()` to disambiguate.** `.first()` resolves ambiguity by document order, which is a property of the layout, not of the thing being asserted. It converts an ambiguous locator into a passing test rather than into an error.

## Solution

Decide, per call site, whether substring matching is what you want, and make it explicit either way.

When you mean exactly one element, say so (`e2e/accessories-serialized.spec.ts`):

```ts
// The header renders a plain "Edit"; attachment rows render
// aria-label="Edit <type> attachment". Without exact:true this matches both.
await page.getByRole("button", { name: "Edit", exact: true }).click();
```

When substring breadth is the point, keep the bare name and record why:

```ts
// Bare "Edit" matches by substring, so this covers the accessory-level
// control AND every "Edit <type> attachment" button in one assertion.
await expect(vp.getByRole("button", { name: "Edit" })).toHaveCount(0);
```

The two live in the same spec and are both correct; what makes them correct is that the choice is deliberate and stated.

## Why This Works

The accessible names in question are generated, not literal. `app/(app)/accessories/attachments-section.tsx:305` builds ``aria-label={`Edit ${attachmentTypeLabel(item.type)} attachment`}``, while `app/(app)/accessories/accessory-detail-view.tsx:208` renders a button whose text is just `Edit`. A substring match over that name space returns a set, not an element.

`exact: true` narrows the set to the intended one. Leaving it off narrows nothing and hands disambiguation to `.first()`, which answers a different question — "which is earliest in the DOM" — that the test never meant to ask.

The asymmetry matters for absence assertions specifically. For `toHaveCount(0)`, substring matching makes the assertion *stronger*: one bare-name check covers a whole family of generated labels. For a click or a `toHaveValue`, it makes the locator *weaker*. Same default, opposite consequence, which is why a blanket "always use exact" rule is the wrong takeaway.

## Prevention

**Ask what the locator selects, not what it reads like.** Before a name-based click or value assertion, check whether any other element's accessible name *contains* the string. Generated labels (``aria-label={`... ${x} ...`}``) are where this bites, because the containing name does not exist anywhere in the source as a literal.

**Treat `.first()` as a smell on a name-based locator.** It is appropriate for a genuinely repeated element (a row in a list). On a locator meant to identify one control, it is converting an ambiguity into a silent pass — prefer `exact: true`, or scope to a container.

**This repository has no `data-testid` escape hatch.** `AGENTS.md` requires targeting UI via ARIA roles, accessible names, and visible text, so accessible-name matching is the only selector strategy in the e2e suite and this default applies to effectively every locator in it.

**Verify a locator change actually changes the selection.** A locator edit that "fixes" ambiguity should be confirmed against the page — an assertion that still resolves to two elements, or now to zero, fails in ways that look like unrelated flake.
