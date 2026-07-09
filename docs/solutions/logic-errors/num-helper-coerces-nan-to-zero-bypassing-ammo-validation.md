---
title: "Numeric input helper coerces invalid values to zero, bypassing ammo form validation"
date: 2026-07-07
category: docs/solutions/logic-errors
module: "app/(app)/ammo/ammo-form"
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Clearing a numeric field (grain, quantity, or low-stock threshold) in the ammo form saves the lot with a 0 instead of surfacing a validation error"
  - "Pasting non-numeric text into a numeric ammo field silently coerces to 0 and passes validation instead of being rejected"
  - "validateAmmo's invalidGrain/invalidQuantity/invalidThreshold error codes never appear as an error message or aria-invalid state on the field"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [nan-coercion, form-validation, ammo-form, react-forms, validation-bypass, recurring-bug]
---

# Numeric input helper coerces invalid values to zero, bypassing ammo form validation

## Problem

The ammo inventory form's numeric input helper coerced any unparseable or cleared field to `0` before validation ever ran. Because `0` is a legitimate value for grain weight, quantity, and low-stock threshold, the validator had nothing to reject — an empty field or pasted garbage silently became a valid zero-value ammo lot instead of surfacing a field error. A second, compounding gap meant that even the validation codes that *did* fire in adjacent cases (`invalidGrain`, `invalidQuantity`, `invalidThreshold`) were never wired into the form's error display, so those failures were invisible too.

## Symptoms

- Clearing the grain, quantity, or low-stock-threshold field and submitting the ammo form saved a row with the numeric value silently set to `0`, with no error shown to the user.
- Pasting non-numeric text (e.g. `"abc"`) into a numeric field produced the same silent-zero behavior instead of a validation error.
- Even when `validateAmmo` returned an `invalid*` code for a numeric field, the form's `<Field error={...}>` and `aria-invalid` logic only checked for `negative*` codes, so the error never rendered — the field looked valid regardless of what the validator returned.
- The underlying data was never corrupted (the DB `int4` CHECK constraint and server-side re-validation both still held), so this manifested purely as a silent UX failure: bad input got accepted and saved as if it were intentional.

## What Didn't Work

The original helper looked like defensive coding, not a bug:

```ts
function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;  // NaN -> 0
}
```

`Number.isFinite(n) ? n : 0` reads as "guard against NaN propagating downstream" — a pattern that's often correct when you just need *a* number to do arithmetic with. The problem is that this coercion ran *before* `validateAmmo`, so it wasn't guarding against NaN propagating into broken math — it was laundering an invalid input into a value (`0`) that the validator considered perfectly legal. The submit flow was:

```ts
const fields = {
  caliber,
  grain: num(values.grain),
  quantityRounds: num(values.quantityRounds),
  lowStockThreshold: num(values.lowStockThreshold),
};
const found = validateAmmo(fields);
if (found.length > 0) return;
```

By the time `validateAmmo` saw the data, the invalid signal (NaN) was already gone. No amount of strengthening `validateAmmo` itself would have caught this, because the function was never given the chance to see the bad value — the coercion order was the actual defect, not the validation logic. This is why the bug slipped past review for a while: the validator itself was correct and already had the right rejection logic (`isStorableCount`), it just never got to run against the real input.

## Solution

Two changes, both in `app/(app)/ammo/ammo-form.tsx`, fixed in commit `ced43e7` (PR #54):

**1. Stop coercing invalid input into a valid value.** Map both unparseable *and empty* input to `NaN`, then pass it to the validator untouched:

```ts
// Cleared ("" -> Number("") is 0!) or unparseable input becomes NaN, not a
// silent value, so validateAmmo's isStorableCount rejects it visibly instead
// of saving a zero-value lot.
function num(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}
```

> **Watch the empty-string case.** `Number("")` and `Number("   ")` are `0`, **not** `NaN` — so a bare `return Number(value)` still lets a *cleared* field silently become `0` (only truly unparseable text like `"abc"` yields `NaN`). The explicit `value.trim() === ""` guard is what makes a cleared field fail validation too. The first ammo fix missed this and had to be revised.

**2. Wire every validation code the validator can emit into the form's error display.** The validator (`src/domain/ammo/validate.ts`) already emitted both `negative*` and `invalid*` codes:

```ts
export const MAX_COUNT = 2_147_483_647;

function isStorableCount(n: number): boolean {
  return Number.isInteger(n) && n <= MAX_COUNT;
}

// validateAmmo:
if (input.grain < 0) {
  codes.push("negativeGrain");
} else if (!isStorableCount(input.grain)) {
  codes.push("invalidGrain");
}
// same pattern for quantityRounds / lowStockThreshold
```

but the form only read the `negative*` half:

```ts
// Before: only checked negativeGrain
<Field error={firstMessage(codes, ["negativeGrain"])}>
```

The fix adds the `invalid*` codes alongside the `negative*` ones for every numeric field:

```ts
// After: checks both negativeGrain and invalidGrain
<Field error={firstMessage(codes, ["negativeGrain", "invalidGrain"])}>
```

```ts
aria-invalid={codes.includes("negativeGrain") || codes.includes("invalidGrain")}
```

(repeated for `quantityRounds`/`invalidQuantity` and `lowStockThreshold`/`invalidThreshold`). `step={1}` was also added to the integer number inputs so the browser's native stepping matches the integer-only validation rule.

## Why This Works

`NaN < 0` evaluates to `false` and `Number.isInteger(NaN)` evaluates to `false`, so once `num()` stops masking bad input, `validateAmmo` naturally falls into the `!isStorableCount(input.grain)` branch and pushes `invalidGrain` (or the quantity/threshold equivalent) — no changes to the validator's rejection logic were needed, because that logic was already correct. The only thing missing was giving it unmangled input.

Wiring the `invalid*` codes into `firstMessage(...)` and `aria-invalid` closes the second half of the gap: a validation code that the validator can produce but the form never reads is functionally identical to not validating at all, from the user's perspective. Making the form check every code the validator can emit turns "the validator technically caught it" into "the user actually sees it."

Because the DB `int4` CHECK constraint and the server-side re-validation layer were unaffected by this bug, no corrupted data reached persistence — this was strictly a client-side feedback/UX defect, which is also why it was safe to fix without a data migration or backfill.

## Prevention

1. **Convert-for-validation must preserve invalidity.** Never map unparseable input to a value that the validator considers valid (like `0` for a numeric field with a legal zero). Map it to `NaN` or another sentinel that is guaranteed to fail validation:

   ```ts
   // WRONG — "safe" fallback launders invalid input into valid data
   function num(value: string): number {
     const n = Number(value);
     return Number.isFinite(n) ? n : 0;
   }

   // ALSO WRONG — Number("") is 0, so a cleared field still becomes a silent 0
   function num(value: string): number {
     return Number(value);
   }

   // RIGHT — empty AND unparseable both become NaN so the validator rejects them
   function num(value: string): number {
     return value.trim() === "" ? Number.NaN : Number(value);
   }
   ```

2. **Run validation on the exact representation you're about to persist, and make sure no coercion happens between "parse user input" and "validate."** If a coercion step runs first, audit whether it can turn an invalid value into one the validator accepts.

3. **Wire every code the validator can emit into the form's error display.** Do a code-level audit: for each field's error prop / `aria-invalid` check, confirm it lists every code that function can return for that field, not just the first one that was implemented. A validator emitting a code that no UI ever reads is an invisible failure mode.

4. **Add a test that asserts the validator rejects NaN, empty-string-derived, and non-integer numeric input directly** — not just negative numbers:

   ```ts
   describe("validateAmmo", () => {
     it("rejects NaN grain (e.g. from an unparseable form field)", () => {
       const result = validateAmmo({ caliber: "9mm", grain: Number("abc"), quantityRounds: 10, lowStockThreshold: 1 });
       expect(result).toContain("invalidGrain");
     });

     it("rejects non-integer quantity", () => {
       const result = validateAmmo({ caliber: "9mm", grain: 115, quantityRounds: 10.5, lowStockThreshold: 1 });
       expect(result).toContain("invalidQuantity");
     });

     it("rejects quantity above MAX_COUNT", () => {
       const result = validateAmmo({ caliber: "9mm", grain: 115, quantityRounds: MAX_COUNT + 1, lowStockThreshold: 1 });
       expect(result).toContain("invalidQuantity");
     });
   });
   ```

**Recurrence — found and fixed:** `app/(app)/magazines/magazine-form.tsx` had the identical `num()` helper (`Number.isFinite(n) ? n : 0`) feeding `baseCapacity`/`extensionRounds`, and `validateMagazine` had **no** integer/int4 check at all (only `< 1` / `< 0`), so an overflow value would have reached the DB as a raw error. Fixed alongside this learning by mirroring the ammo fix: the empty-safe `num()`, `isStorableCount` + `baseCapacityInvalid`/`extensionRoundsInvalid` codes in `validateMagazine`, the form wiring, and a NaN-guard on the bulk `addCount`. This closed the magazine half of issue #53.

Any form in this codebase that shares this `num()` helper shape should be audited and patched the same way: use the empty-safe `num()` (above), ensure the field's validator rejects `NaN`/non-integer/out-of-range values, and confirm the form reads every `invalid*`/`negative*` code the validator can produce.

## Related Issues

- [#53 — Numeric inventory fields lack int4 upper-bound validation](https://github.com/unclesp1d3r/mag_stacker/issues/53) (open) — the originating report; this fix covers the ammo side. #53 stays open for the same gap in magazine `baseCapacity`/`extensionRounds`.
- [PR #54 — Add ammo inventory tracking](https://github.com/unclesp1d3r/mag_stacker/pull/54) — introduced `ammo-form.tsx` and `validate.ts`; the `num()` fix landed here (commit `ced43e7`) during PR review (flagged by CodeRabbit).
- [#52 — Summary caliber coverage joins firearm/ammo free text by exact equality](https://github.com/unclesp1d3r/mag_stacker/issues/52) (closed) — sibling finding from the same review pass on the ammo branch; a distinct string-normalization bug, related by origin, not mechanism.
- [#7 — Add ammo inventory tracking with low-stock alerts and summary rollups](https://github.com/unclesp1d3r/mag_stacker/issues/7) (closed) — parent feature.
