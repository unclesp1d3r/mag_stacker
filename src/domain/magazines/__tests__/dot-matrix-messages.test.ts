/**
 * The copy KTD8 defines, asserted as text (U6; R4, R9, R9a).
 *
 * These strings were exported and rendered but read by nothing — a swapped
 * branch or a reworded Callout would have shipped silently. There is no
 * component-test harness in this repo (U5's note), so the messages are
 * checked here at the builder level and the *placement* of each Callout is
 * covered by `e2e/magazine-dot-matrix.spec.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  buildOmittedCharactersCaveat,
  buildUnrepresentableMessage,
  LABEL_DOES_NOT_FIT_MESSAGE,
  LABEL_NOT_PAINTABLE_MESSAGE,
  MODEL_NOT_RECOGNIZED_CAVEAT,
  UNVERIFIED_CELL_COUNT_SUFFIX,
} from "@/app/(app)/magazines/dot-matrix-label";

describe("R4 unrecognized-model caveat (KTD8)", () => {
  test("names the cell count the owner must confirm before painting", () => {
    expect(MODEL_NOT_RECOGNIZED_CAVEAT).toBe(
      "Model not recognized — confirm this floorplate has 4 dot cells before painting.",
    );
  });
});

describe("R9 messages (KTD8)", () => {
  test("a verified overflow states only that the label does not fit", () => {
    expect(buildUnrepresentableMessage("doesNotFit", true)).toBe(
      "This label does not fit this magazine's floorplate.",
    );
  });

  test("an unverified overflow appends the unverified-cell-count clause", () => {
    expect(buildUnrepresentableMessage("doesNotFit", false)).toBe(
      "This label does not fit this magazine's floorplate. The model was not recognized, so the 4-cell count is unverified.",
    );
  });

  test("the composed unverified message is exactly the two constants joined", () => {
    // Guards the composition itself, so a future edit to either constant
    // cannot leave the joined string malformed (a missing space, say).
    expect(buildUnrepresentableMessage("doesNotFit", false)).toBe(
      `${LABEL_DOES_NOT_FIT_MESSAGE}${UNVERIFIED_CELL_COUNT_SUFFIX}`,
    );
  });

  test("a label with nothing paintable gets its own message, not the overflow one", () => {
    // The whole reason `reason` exists: "does not fit" is false here.
    expect(buildUnrepresentableMessage("unsupportedCharacter", true)).toBe(
      "None of this label's characters can be painted on a Magpul floorplate.",
    );
    expect(buildUnrepresentableMessage("unsupportedCharacter", true)).not.toBe(
      LABEL_DOES_NOT_FIT_MESSAGE,
    );
  });

  test("the not-paintable message never carries the unverified clause, since no cell count was consulted", () => {
    expect(buildUnrepresentableMessage("unsupportedCharacter", false)).toBe(
      LABEL_NOT_PAINTABLE_MESSAGE,
    );
    expect(
      buildUnrepresentableMessage("unsupportedCharacter", false),
    ).not.toContain(UNVERIFIED_CELL_COUNT_SUFFIX.trim());
  });
});

describe("R9a omitted-characters caveat", () => {
  test("names a single dropped character in the singular", () => {
    expect(buildOmittedCharactersCaveat(["-"])).toBe(
      'Left out of the pattern: "-" — the Magpul floorplate font has no glyph for it.',
    );
  });

  test("lists several dropped characters in the plural", () => {
    expect(buildOmittedCharactersCaveat(["-", "."])).toBe(
      'Left out of the pattern: "-", "." — the Magpul floorplate font has no glyph for them.',
    );
  });
});
