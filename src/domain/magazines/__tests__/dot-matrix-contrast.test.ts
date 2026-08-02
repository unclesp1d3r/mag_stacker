/**
 * R15 contrast guard for the dot-matrix tokens (U5, KTD5, KTD6).
 *
 * Parses `app/globals.css` directly rather than importing a bundled
 * stylesheet, because Tailwind v4 silently no-ops an unknown utility class
 * (`docs/solutions/best-practices/prefix-collision-safe-token-renaming.md`)
 * — a typo'd token name would produce no build error, only a wrong render.
 * This test is the only thing that would catch a missing or misnamed
 * `--dot-painted` / `--dot-unpainted` declaration in either theme block.
 *
 * Deliberately does NOT assert a contrast ratio between the two dot tokens
 * against each other — KTD5 measured that at 2.67:1 in the dark theme, which
 * would fail a same-token-pair 3:1 assertion. R15's "visually distinct from
 * one another" clause is carried by the differing dot diameters (KTD6)
 * instead, asserted below.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PAINTED_DOT_DIAMETER_PX,
  UNPAINTED_DOT_DIAMETER_PX,
} from "@/app/(app)/magazines/dot-matrix-label";

const CSS_PATH = path.join(process.cwd(), "app/globals.css");

/** Finds the `{ ... }` block whose selector list contains `selectorFragment`. */
function extractThemeBlock(css: string, selectorFragment: string): string {
  const selectorIndex = css.indexOf(selectorFragment);
  if (selectorIndex === -1) {
    throw new Error(
      `Selector fragment "${selectorFragment}" not found in ${CSS_PATH}.`,
    );
  }
  const braceStart = css.indexOf("{", selectorIndex);
  const braceEnd = css.indexOf("}", braceStart);
  if (braceStart === -1 || braceEnd === -1) {
    throw new Error(
      `Could not find a { ... } block following "${selectorFragment}".`,
    );
  }
  return css.slice(braceStart + 1, braceEnd);
}

/** Reads a token declared as a literal hex color, e.g. `--card: #1a1e24;`. */
function extractHexToken(block: string, tokenName: string): string {
  const match = block.match(
    new RegExp(`--${tokenName}:\\s*(#[0-9a-fA-F]{3,8})`),
  );
  if (!match?.[1]) {
    throw new Error(`Token "--${tokenName}" not found as a hex color.`);
  }
  return match[1];
}

/** Asserts a token is declared as a `var(--otherToken)` alias and returns the target name. */
function extractAliasTarget(block: string, tokenName: string): string {
  const match = block.match(
    new RegExp(`--${tokenName}:\\s*var\\(--([a-zA-Z0-9-]+)\\)`),
  );
  if (!match?.[1]) {
    throw new Error(`Token "--${tokenName}" is not declared as a var() alias.`);
  }
  return match[1];
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) {
    throw new Error(`Unsupported hex color "${hex}"; expected 6 digits.`);
  }
  const value = Number.parseInt(clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rNorm, gNorm, bNorm] = [r, g, b].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rNorm + 0.7152 * gNorm + 0.0722 * bNorm;
}

/** WCAG contrast ratio (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio). */
function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexToRgb(hexA));
  const luminanceB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

const NON_TEXT_CONTRAST_FLOOR = 3; // WCAG 1.4.11

const THEMES = [
  { name: "dark", selectorFragment: '[data-theme="dark"]' },
  { name: "light", selectorFragment: '[data-theme="light"]' },
] as const;

describe("dot-matrix tokens clear WCAG 1.4.11 (R15, KTD5)", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  for (const theme of THEMES) {
    describe(`${theme.name} theme`, () => {
      const block = extractThemeBlock(css, theme.selectorFragment);

      test("--dot-painted and --dot-unpainted are both declared", () => {
        // A token present in only one theme block is exactly the failure
        // Tailwind's silent no-op would not report.
        expect(extractAliasTarget(block, "dot-painted")).toBe("foreground");
        expect(extractAliasTarget(block, "dot-unpainted")).toBe(
          "muted-foreground",
        );
      });

      test("--dot-painted (aliased to --foreground) clears 3:1 against --card", () => {
        const foreground = extractHexToken(block, "foreground");
        const card = extractHexToken(block, "card");
        expect(contrastRatio(foreground, card)).toBeGreaterThanOrEqual(
          NON_TEXT_CONTRAST_FLOOR,
        );
      });

      test("--dot-unpainted (aliased to --muted-foreground) clears 3:1 against --card", () => {
        const mutedForeground = extractHexToken(block, "muted-foreground");
        const card = extractHexToken(block, "card");
        expect(contrastRatio(mutedForeground, card)).toBeGreaterThanOrEqual(
          NON_TEXT_CONTRAST_FLOOR,
        );
      });
    });
  }
});

describe("dot-matrix geometry carries R15's visual-distinctness clause (KTD6)", () => {
  test("painted and unpainted dot diameters differ", () => {
    // Deliberately not a token-vs-token contrast assertion (KTD5: 2.67:1 in
    // dark theme). The radius difference is what R15 relies on instead.
    expect(PAINTED_DOT_DIAMETER_PX).not.toBe(UNPAINTED_DOT_DIAMETER_PX);
  });
});
