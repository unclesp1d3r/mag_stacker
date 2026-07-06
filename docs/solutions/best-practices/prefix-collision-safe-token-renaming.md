---
title: "Boundary-safe, value-preserving design-token renames (Tailwind v4 / shadcn)"
date: 2026-07-06
category: best-practices
module: styles/design-tokens
problem_type: best_practice
component: tooling
severity: high
root_cause: logic_error
resolution_type: workflow_improvement
applies_when:
  - "Renaming design tokens, CSS custom properties, or utility classes via bulk find-and-replace where some retired short tokens are literal prefixes of tokens that must be kept (e.g. retiring `ink` while keeping `ink-soft`)"
  - "Verifying completeness of a CSS/Tailwind utility-class or token rename, since Tailwind v4 emits no build error for an unknown utility class — a missed rename fails silently at runtime, not at compile time"
  - "Any repo-wide text substitution where replacement keys can be substrings of other keys that must survive"
related_components: [documentation, development_workflow]
tags: [tailwind-v4, design-tokens, shadcn, refactoring, regex, migration, verification, grep-gate]
---

# Boundary-safe, value-preserving design-token renames (Tailwind v4 / shadcn)

## Context

Retiring a shadcn "token bridge" in favor of shadcn-canonical tokens everywhere (GitHub issue #47, PR #50) meant migrating roughly 28 files off a project-specific palette — Tailwind utilities like `bg-paper`, `text-ink`, `border-line` — onto shadcn's canonical names: `bg-background`, `text-foreground`, `border-border`. This was not a clean 1:1 vocabulary swap. The project's "Machined Console" palette is richer than shadcn's: it has tokens shadcn has no analog for at all — `--ink-soft`, `--steel`, `--ok`, `--danger-soft` — and those extended tokens had to survive the migration completely untouched, at both the CSS-variable and Tailwind-utility level.

That combination — a scripted rename across many files, applied to a token vocabulary where the retired names are common English words that are also prefixes of the tokens being kept — is exactly the shape that causes silent corruption. It recurs any time a design system absorbs, replaces, or renames a subset of its tokens rather than doing a full vocabulary swap.

## Guidance

**1. Treat the rename as a targeted map, not a global regex.** Build an explicit ordered list of `(retired_token, canonical_token)` pairs. The extended/kept tokens (`ink-soft`, `steel`, `ok`, `danger-soft`) simply never appear in the map — they are excluded by construction, not by a negative-match rule that could be gotten wrong.

**2. Process longest-token-first.** A retired short token can be a literal prefix of a kept compound token: `ink` is a prefix of `ink-soft`; `danger` is a prefix of `danger-soft`. If the substitution pass hits `paper`, `ink`, or `blaze` before it hits `paper-raised`, `ink-faint`, or `blaze-soft`, the short substitution fires first and corrupts the compound name before the compound rule ever gets a chance to match. Sort the map so multi-word/hyphenated retired tokens are substituted before their shorter prefixes.

**3. Use a token boundary that excludes hyphen-continuation, not just `\b`.** A standard word-boundary `\b` still matches inside `text-ink-soft`, because there genuinely is a word boundary between `ink` and `-soft` (letter-to-hyphen is a transition regex engines treat as a boundary). The correct boundary is a negative lookahead that rejects a following `-` or word character: `(?![\w-])`. POSIX `grep`/`sed` don't support lookahead, so this has to be done in Perl (or another PCRE-capable tool/engine).

```perl
# Ordered longest-first; extended tokens (ink-soft, steel, ok, danger-soft)
# are ABSENT from the map => never touched.
my @map = (
    ['paper-raised', 'card'],
    ['paper-sunken', 'muted'],
    ['paper',        'background'],
    ['ink-faint',    'muted-foreground'],
    ['ink',          'foreground'],
    ['line-strong',  'input'],
    ['line',         'border'],
    ['blaze-ink',    'primary-foreground'],
    ['blaze-soft',   'accent'],
    ['blaze',        'primary'],
    ['danger',       'destructive'],
);
my $prefixes = qr/bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|accent/;
for my $p (@map) {
    my ($tok, $canon) = @$p;
    my $q = quotemeta $tok;
    $src =~ s/(?<![\w])($prefixes)-$q(?![\w-])/$1-$canon/g;  # utility class
    $src =~ s/var\(--$q\)/var(--$canon)/g;                    # CSS var / arbitrary value
}
```

**4. Migrate consumers while the old names still resolve, then delete the old definitions last.** Keep the bridge/alias layer live while every file is switched to the new utility names, so the new names already resolve correctly during the migration and nothing goes visually blank mid-flight. Only delete the retired CSS variables and the bridge itself after verification is clean.

**5. Verification must be a boundary-aware grep-gate, not a build check** — see Why This Matters for why the compiler can't do this job. Grep the same three surfaces the rename touched (`app/`, `components/`, the stylesheet) for zero remaining references to any retired token — as a utility class, as a `var(--token)`, and as an arbitrary Tailwind value — while explicitly excluding the kept extended tokens from the gate. If the gate's pattern isn't itself boundary-safe, it reports false positives on the same compound names the rename script had to protect, which makes the gate useless as a correctness signal (see the 64-vs-39 count in Why This Matters).

**6. Expect some renames to be contextual, not mechanical.** One retired token can map to two different canonical targets depending on where it's used — e.g., `text-blaze` becomes `text-accent-foreground` when it sits on a `bg-accent` surface, but `text-primary` everywhere else. Script the rows that are unambiguous 1:1; hand-resolve the handful that need surrounding context. Don't force a contextual rename into the scripted map just to get 100% automation — that's how a script silently produces the wrong contrast pairing.

**7. Watch for shell glob expansion when passing file lists to the migration script.** Next.js App Router paths routinely contain glob metacharacters — parenthesized route groups (`app/(app)/…`) and bracketed dynamic segments (`app/(app)/firearms/[id]/page.tsx`). Passing such a list unquoted lets the shell expand it before the script ever sees it, producing mangled arguments (observed failure mode: "File name too long"). Use `find … -print0 | xargs -0` (or an equivalent null-delimited pipeline) instead of interpolating a bare file list into a command line.

## Why This Matters

Tailwind v4 does not error on an unknown utility class — it silently generates nothing for it. If the rename script misses a reference, or a boundary bug corrupts a kept compound token into something like `text-foreground-soft`, the build succeeds, `tsc --noEmit` is clean, and the only symptom is an element that renders unstyled or with the wrong color at runtime. There is no compiler signal to catch this class of mistake, which is exactly why the grep-gate has to carry the correctness burden that a type system or build step would normally carry in other kinds of refactors.

The boundary bug is not hypothetical — it's exactly what a first verification pass caught. A grep for the literal string `text-ink` across the codebase returned 64 hits. Of those, only 39 were genuine references to the retired `text-ink` utility; the other 25 were false-positive prefix matches sitting inside the kept `text-ink-soft` class, which a naive boundary treats as a match because `\b` fires between `k` and `-`. Had the rename script used that same naive boundary, it would have rewritten 25 correct, intentionally-kept `text-ink-soft` classes into a broken `text-foreground-soft` utility that Tailwind v4 would then silently fail to generate — a regression that would not show up in any CI check except a live-rendered visual diff.

This migration also had to be value-preserving, not just name-preserving: the canonical tokens (`background`, `foreground`, `card`, `muted`, `primary`, `accent`, `border`, `destructive`, …) were defined to carry the exact same hex values, in both dark and light themes, that the retired Machined Console tokens had. That constraint eliminates the contrast/accessibility risk a rename could otherwise introduce — the only remaining risk after the value mapping is a dangling or corrupted reference, which is precisely what the boundary-safe grep-gate is built to catch.

The full verification stack that closed this out: boundary-aware grep-gate at zero remaining retired references, `tsc --noEmit` clean, Biome clean, 276 unit tests passing, 24 Playwright e2e specs including a dedicated both-theme `theme.spec.ts`, and a live browser check confirming the computed CSS custom properties actually resolve in both themes (`--background:#15181c` / `--primary:#ffb240` in dark; body `rgb(243,242,238)` / `rgb(30,28,25)` in light). No single one of those checks alone would have caught a silently corrupted compound token — the grep-gate is the one doing that specific job, and it only works because it's boundary-aware in the same way the rename script is.

## When to Apply

- Any scripted rename of Tailwind utility classes, CSS custom properties, or similarly prefixed/compound token names, where the rename is partial (some names retired, others deliberately kept).
- Any migration from a project-specific design-token vocabulary onto a component library's canonical vocabulary (shadcn, Radix Themes, or similar), where the project's palette is a strict superset of the target's.
- Any situation where a short token name is a literal prefix of a longer, unrelated token that must be preserved (`ink` vs `ink-soft`, `danger` vs `danger-soft`, or analogous cases in spacing scales, color scales, or component-variant naming).
- Whenever Tailwind v4 (or any utility-class system that silently no-ops unknown classes) is in play and the migration cannot rely on a compiler to catch a missed or corrupted reference.
- Any rename pass where the substitution tool is POSIX `grep`/`sed`-only — that's the signal to switch to Perl, ripgrep with lookaround support, or another PCRE-capable tool before writing the rules.

## Examples

**Boundary-unsafe vs. boundary-safe pattern, on the actual failure case:**

```text
Input:            <div class="text-ink-soft">
Naive \b regex:   s/\btext-ink\b/text-foreground/  -> matches! (boundary exists between k and -)
Result:           <div class="text-foreground-soft">   # BROKEN — Tailwind v4 generates nothing for this
```

```text
Input:            <div class="text-ink-soft">
Boundary-safe:    s/(?<![\w])(text)-ink(?![\w-])/$1-foreground/
Result:           <div class="text-ink-soft">           # unchanged, correctly excluded
```

**Verification grep-gate shape (run against `app/`, `components/`, and the stylesheet, excluding kept extended tokens):**

```bash
# Boundary-safe check for zero remaining references to any retired token,
# as a utility class or CSS var, while never flagging kept extended tokens
# like ink-soft, steel, ok, danger-soft.
find app components -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \) -print0 \
  | xargs -0 perl -ne '
      print "$ARGV:$.: $_"
        if /(?<![\w])(bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|accent)-(paper|ink|line|blaze|danger)(?![\w-])/
        || /var\(--(paper|ink|line|blaze|danger)\)/;
    '
```

**Safe file-list handling for App Router paths with glob metacharacters:**

```bash
# WRONG — shell glob-expands (app/(app)/... and [id] segments) before the script sees them
perl migrate-tokens.pl app/(app)/**/*.tsx    # -> "File name too long" / mangled args

# CORRECT — null-delimited, no shell interpretation of the paths
find app components -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \) -print0 \
  | xargs -0 perl migrate-tokens.pl
```

**Contextual (non-scriptable) rename, resolved by hand rather than forced into the map:**

```tsx
// Same retired token, two different canonical targets depending on surface context
<div className="bg-accent">
  <span className="text-accent-foreground">Label on an accent surface</span>
</div>

<div className="bg-background">
  <span className="text-primary">Same retired `text-blaze` class, different surface</span>
</div>
```

## Related

- GitHub issue #47 — Remove shadcn token bridge; adopt shadcn tokens everywhere (source)
- PR #50 — the migration that produced this learning
- [[e2e-dotenv-mise-clobbers-launcher-env]] and [[tanstack-autoreset-render-loop-unstable-data]] — other frontend/testing gotchas in this repo (unrelated domains)
