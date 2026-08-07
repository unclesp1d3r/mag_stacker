---
title: "A widened union routed to the wrong table because the dispatch ended in a fallback, not an exhaustive check"
module: auth
date: 2026-08-07
problem_type: logic_error
component: authentication
severity: high
root_cause: logic_error
resolution_type: code_fix
related_components:
  - database
  - development_workflow
tags:
  - typescript
  - exhaustiveness
  - discriminated-union
  - drizzle
  - authorization
  - parent-type
---

# A widened union routed to the wrong table because the dispatch ended in a fallback

## Problem

`ParentType` is the closed set of item families that carry their own grants. Adding a member to it is presented as a one-line change, and the type's own docblock claimed a clean `bun run typecheck` proved the change was complete. It did not: the function that maps a `ParentType` to its Drizzle table ended in an unconditional fallback, so a new member silently resolved to whatever table that fallback named.

## Symptoms

- No build failure, no test failure, no runtime error — the wrong table is simply queried.
- Permission and visibility reads for the new item family return results computed against a different family's rows.
- A `tsc` run that a reviewer (or an agent) cites as evidence of completeness is passing for a reason unrelated to the claim.

## What Didn't Work

- **Trusting the typecheck.** `bun run typecheck` was clean before and after widening the union. That was taken as proof the widening was complete, and written into both a code comment and a commit message. The fallback absorbed the new arm, so the compiler had nothing to say.
- **Trusting a comment written in the same file.** The docblock asserting `tsc`-completeness sat a few lines above the very function that broke the claim. A second comment elsewhere in the same codebase (`app/(app)/grants/share-control.tsx`) independently warned that widening `ParentType` is *not* self-enforcing — two comments in one repo contradicting each other, neither noticed while writing.
- **Grepping for consumers.** Finding the call sites is not the same as knowing which ones fail closed. Several consumers pattern-match on the string with no exhaustiveness check at all (`src/domain/inventory-log/service.ts`, `app/(app)/inventory-log/inventory-log-history.tsx`), so a repo-wide grep produces a list without telling you which entries are safe.

## Solution

Before, in `src/auth/visibility.ts` (this is the shape on `main`, with three members):

```ts
export function parentTable(parentType: ParentType) {
  if (parentType === "firearm") return firearm;
  if (parentType === "magazine") return magazine;
  return ammo;                    // <- absorbs anything not matched above
}
```

Adding `"accessory"` to the union without touching this function compiles cleanly and returns the **ammo** table for every accessory.

After (`src/auth/visibility.ts:43`):

```ts
export function parentTable(parentType: ParentType) {
  switch (parentType) {
    case "firearm":
      return firearm;
    case "magazine":
      return magazine;
    case "ammo":
      return ammo;
    case "accessory":
      return accessory;
    default: {
      const unhandled: never = parentType;
      throw new Error(`unhandled parent type: ${String(unhandled)}`);
    }
  }
}
```

Verify the guard is real rather than decorative — add a member to the union and confirm the build fails:

```
error TS2322: Type '"holster"' is not assignable to type 'never'.
```

## Why This Works

Assigning the switch subject to a `never`-typed local is only valid when the compiler has narrowed it to `never`, which happens only when every union member is handled above. A new member narrows to itself instead, and the assignment fails at build time.

The `if`/`if`/`return X` shape cannot do this: the final `return` is reached by *anything* that did not match, so there is no position where the compiler can observe an unhandled case. The two shapes look equivalent and are not — one makes the exhaustiveness claim checkable, the other makes it unfalsifiable.

The runtime `throw` in the default branch is not dead code here. `ParentType` is a compile-time construct with no runtime validation, and the value reaches `parentTable` from Server Action arguments (`app/(app)/grants/actions.ts`, `src/auth/grants.ts`), so a crafted payload can carry a string outside the union. The throw is contained: those paths run inside `withActionContext`, which logs and returns a non-leaking result.

## Prevention

**Treat "the typecheck passed" as evidence only when you can name the construct that would have failed.** If the answer is a `never` assignment, an exhaustive `Record<Union, T>`, or a discriminated-union switch, the claim holds. If it is an if/else chain, an object literal with a default, or a `??` fallback, the typecheck proves nothing about completeness and the claim should not be written down.

**Prefer shapes that fail closed when a union grows.** In this codebase, `PERMISSION_RANK: Record<Permission, number>` (`src/auth/accessory-visibility.ts`) is the good example — adding a `Permission` member fails the build until a rank is supplied. It sat in the same layer as the broken dispatch, which is why the contrast is worth naming.

**When widening a union, audit the consumers that cannot fail closed.** A `never` check protects one dispatch; it does not protect consumers that pattern-match the string. `app/(app)/grants/share-control.tsx` deliberately uses an allowlist rather than `!== "magazine"` so a future member defaults to the restrictive branch instead of silently gaining a capability. That pattern — allowlist, not denylist — is the right default wherever exhaustiveness cannot be enforced.

**Test the guard, not just the code.** Adding a member and confirming the build breaks takes seconds and is the only thing that distinguishes a real exhaustiveness check from a comment claiming one.
