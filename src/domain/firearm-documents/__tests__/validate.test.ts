import { describe, expect, test } from "bun:test";
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_REQUEST } from "../constants";
import {
  assertBatchSize,
  isDocType,
  validateDocumentUpload,
} from "../validate";

describe("validateDocumentUpload (U2, R5)", () => {
  test("a disallowed MIME type returns disallowedMimeType", () => {
    expect(
      validateDocumentUpload({ mimeType: "application/zip", sizeBytes: 10 }),
    ).toEqual(["disallowedMimeType"]);
  });

  test("an oversized file returns fileTooLarge", () => {
    expect(
      validateDocumentUpload({
        mimeType: "application/pdf",
        sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      }),
    ).toEqual(["fileTooLarge"]);
  });

  test("both failures surface together, not first-only", () => {
    expect(
      validateDocumentUpload({
        mimeType: "application/zip",
        sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      }),
    ).toEqual(["disallowedMimeType", "fileTooLarge"]);
  });

  test("an allowed PDF within the size cap passes", () => {
    expect(
      validateDocumentUpload({
        mimeType: "application/pdf",
        sizeBytes: MAX_FILE_SIZE_BYTES,
      }),
    ).toEqual([]);
  });

  test("an allowed image type passes", () => {
    expect(
      validateDocumentUpload({ mimeType: "image/jpeg", sizeBytes: 1024 }),
    ).toEqual([]);
  });
});

describe("assertBatchSize", () => {
  test("a batch over the per-request cap returns tooManyFiles", () => {
    expect(assertBatchSize(MAX_FILES_PER_REQUEST + 1)).toEqual([
      "tooManyFiles",
    ]);
  });

  test("a batch at the cap passes", () => {
    expect(assertBatchSize(MAX_FILES_PER_REQUEST)).toEqual([]);
  });
});

describe("isDocType (R2)", () => {
  test("'other' and each named type are recognized", () => {
    for (const t of [
      "receipt",
      "warranty",
      "atf-form-1",
      "atf-form-4",
      "manual",
      "insurance",
      "other",
    ]) {
      expect(isDocType(t)).toBe(true);
    }
  });

  test("a value outside the set is not a docType", () => {
    expect(isDocType("contract")).toBe(false);
    expect(isDocType("")).toBe(false);
  });
});
