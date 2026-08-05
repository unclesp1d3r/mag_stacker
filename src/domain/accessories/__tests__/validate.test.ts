import { describe, expect, test } from "bun:test";
import { ACCESSORY_CATEGORY_SUGGESTIONS, ACCESSORY_TYPES } from "../constants";
import {
  type AccessoryFields,
  MAX_COST_CENTS,
  validateAccessory,
} from "../validate";

const base: AccessoryFields = {
  type: "optic",
};

describe("validateAccessory", () => {
  test("a valid minimal accessory (type only) returns no codes", () => {
    expect(validateAccessory(base)).toEqual([]);
  });

  for (const type of ACCESSORY_TYPES) {
    test(`${type} is an accepted type`, () => {
      expect(validateAccessory({ ...base, type })).toEqual([]);
    });
  }

  test("a type outside the controlled set yields invalidAccessoryType", () => {
    expect(validateAccessory({ ...base, type: "bipod" })).toEqual([
      "invalidAccessoryType",
    ]);
  });

  test("a blank or whitespace-only type yields invalidAccessoryType", () => {
    expect(validateAccessory({ ...base, type: "" })).toEqual([
      "invalidAccessoryType",
    ]);
    expect(validateAccessory({ ...base, type: "   " })).toEqual([
      "invalidAccessoryType",
    ]);
  });

  test("type matching is exact — casing is not coerced (#23 R1)", () => {
    // The backfill lower()s on the way in; past that point the stored value is
    // always canonical, so the validator must not quietly accept variants.
    expect(validateAccessory({ ...base, type: "Suppressor" })).toEqual([
      "invalidAccessoryType",
    ]);
  });

  test("category is optional now that type carries the classification (#23 R3)", () => {
    expect(validateAccessory({ ...base, category: "" })).toEqual([]);
    expect(validateAccessory({ ...base, category: "   " })).toEqual([]);
    expect(validateAccessory({ ...base, category: undefined })).toEqual([]);
  });

  test("a long-tail free-text category is still accepted verbatim (#8 preserved)", () => {
    expect(validateAccessory({ ...base, category: "red dot mount" })).toEqual(
      [],
    );
  });

  test("negative costCents yields negativeCostCents", () => {
    expect(validateAccessory({ ...base, costCents: -1 })).toEqual([
      "negativeCostCents",
    ]);
  });

  test("costCents above int4 max yields invalidCostCents (#53)", () => {
    expect(
      validateAccessory({ ...base, costCents: MAX_COST_CENTS + 1 }),
    ).toEqual(["invalidCostCents"]);
    expect(validateAccessory({ ...base, costCents: MAX_COST_CENTS })).toEqual(
      [],
    );
  });

  test("non-integer costCents yields invalidCostCents", () => {
    expect(validateAccessory({ ...base, costCents: 12.5 })).toEqual([
      "invalidCostCents",
    ]);
  });

  test("null costCents is ok (unset cost is unknown, not zero)", () => {
    expect(validateAccessory({ ...base, costCents: null })).toEqual([]);
  });

  test("undefined costCents is ok", () => {
    expect(validateAccessory({ ...base, costCents: undefined })).toEqual([]);
  });

  test("invalid installedDate string yields invalidInstalledDate", () => {
    expect(validateAccessory({ ...base, installedDate: "not-a-date" })).toEqual(
      ["invalidInstalledDate"],
    );
    expect(validateAccessory({ ...base, installedDate: "2026-02-31" })).toEqual(
      ["invalidInstalledDate"],
    );
  });

  test("valid installedDate is ok", () => {
    expect(validateAccessory({ ...base, installedDate: "2026-01-15" })).toEqual(
      [],
    );
  });

  test("null installedDate is ok (unset)", () => {
    expect(validateAccessory({ ...base, installedDate: null })).toEqual([]);
  });

  test("returns all failure codes together, not first-only", () => {
    const codes = validateAccessory({
      type: "",
      costCents: -1,
      installedDate: "bogus",
    });
    expect(codes).toContain("invalidAccessoryType");
    expect(codes).toContain("negativeCostCents");
    expect(codes).toContain("invalidInstalledDate");
    expect(codes).toHaveLength(3);
  });
});

// Acquired date — added during implementation, mirroring `validateFirearm`'s
// acquiredDate coverage exactly (service-intervals plan R22/KTD9-parity, see
// the plan's "Scope added during implementation" note).
describe("validateAccessory — acquiredDate", () => {
  test("omitted acquiredDate is valid (unset)", () => {
    expect(validateAccessory(base)).toEqual([]);
  });

  test("null acquiredDate is valid (explicit unset/clear)", () => {
    expect(validateAccessory({ ...base, acquiredDate: null })).toEqual([]);
  });

  test("a real ISO calendar date is valid", () => {
    expect(validateAccessory({ ...base, acquiredDate: "2026-06-14" })).toEqual(
      [],
    );
  });

  test("a malformed date string returns invalidAcquiredDate", () => {
    expect(validateAccessory({ ...base, acquiredDate: "not-a-date" })).toEqual([
      "invalidAcquiredDate",
    ]);
  });

  test("an empty string is treated as malformed, not unset (the caller normalizes '' to null)", () => {
    expect(validateAccessory({ ...base, acquiredDate: "" })).toEqual([
      "invalidAcquiredDate",
    ]);
  });

  test("an impossible calendar day (day overflow) returns invalidAcquiredDate", () => {
    expect(validateAccessory({ ...base, acquiredDate: "2026-02-31" })).toEqual([
      "invalidAcquiredDate",
    ]);
  });

  test("year zero returns invalidAcquiredDate (Postgres's date type has no year 0)", () => {
    expect(validateAccessory({ ...base, acquiredDate: "0000-01-01" })).toEqual([
      "invalidAcquiredDate",
    ]);
  });

  test("combines with other failures rather than short-circuiting", () => {
    expect(
      validateAccessory({
        type: "",
        acquiredDate: "nope",
      }),
    ).toEqual(["invalidAccessoryType", "invalidAcquiredDate"]);
  });
});

// A future acquiredDate must be rejected with the same one-calendar-day
// tolerance `validateFirearm` uses (shared `FUTURE_DATE_TOLERANCE_DAYS`) — a
// future value would silently freeze this accessory's due state (KTD9).
describe("validateAccessory — acquiredDateInFuture", () => {
  test("an acquired date on the server's own day is accepted", () => {
    const asOf = new Date(2026, 5, 15);
    expect(
      validateAccessory({ ...base, acquiredDate: "2026-06-15" }, asOf),
    ).toEqual([]);
  });

  test("an acquired date one day ahead of the server's day is accepted (timezone-ahead submitter case)", () => {
    const asOf = new Date(2026, 5, 15);
    expect(
      validateAccessory({ ...base, acquiredDate: "2026-06-16" }, asOf),
    ).toEqual([]);
  });

  test("an acquired date two days ahead of the server's day is rejected", () => {
    const asOf = new Date(2026, 5, 15);
    expect(
      validateAccessory({ ...base, acquiredDate: "2026-06-17" }, asOf),
    ).toEqual(["acquiredDateInFuture"]);
  });

  test("a far-future acquired date is rejected", () => {
    const asOf = new Date(2026, 5, 15);
    expect(
      validateAccessory({ ...base, acquiredDate: "2099-01-01" }, asOf),
    ).toEqual(["acquiredDateInFuture"]);
  });
});

describe("ACCESSORY_CATEGORY_SUGGESTIONS", () => {
  test("contains suppressor and optic", () => {
    expect(ACCESSORY_CATEGORY_SUGGESTIONS).toContain("suppressor");
    expect(ACCESSORY_CATEGORY_SUGGESTIONS).toContain("optic");
  });

  test("keeps long-tail values that have no controlled type equivalent", () => {
    // #23 KD4: `category` was NOT collapsed into `type`. If this list is ever
    // reduced to ACCESSORY_TYPES, the two classifications have silently merged
    // and the deferred consolidation decision was made by accident.
    expect(ACCESSORY_CATEGORY_SUGGESTIONS).toContain("magwell");
    expect(ACCESSORY_CATEGORY_SUGGESTIONS).toContain("sling");
  });
});
