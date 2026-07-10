import { describe, expect, test } from "bun:test";
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_REQUEST } from "../constants";
import { assertBatchSize, validatePhotoUpload } from "../validate";

describe("validatePhotoUpload (R9)", () => {
  test("a valid JPEG within the size cap passes", () => {
    expect(
      validatePhotoUpload({ mimeType: "image/jpeg", sizeBytes: 1024 }),
    ).toEqual([]);
  });

  test("a disallowed MIME type (e.g. SVG) is rejected", () => {
    expect(
      validatePhotoUpload({ mimeType: "image/svg+xml", sizeBytes: 1024 }),
    ).toEqual(["disallowedMimeType"]);
  });

  test("a non-image MIME type is rejected", () => {
    expect(
      validatePhotoUpload({ mimeType: "application/pdf", sizeBytes: 1024 }),
    ).toEqual(["disallowedMimeType"]);
  });

  test("a file over the size cap is rejected", () => {
    expect(
      validatePhotoUpload({
        mimeType: "image/png",
        sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      }),
    ).toEqual(["fileTooLarge"]);
  });

  test("a file exactly at the size cap passes", () => {
    expect(
      validatePhotoUpload({
        mimeType: "image/png",
        sizeBytes: MAX_FILE_SIZE_BYTES,
      }),
    ).toEqual([]);
  });

  test("a disallowed MIME type over the size cap returns both failures, not first-only", () => {
    expect(
      validatePhotoUpload({
        mimeType: "text/plain",
        sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      }),
    ).toEqual(["disallowedMimeType", "fileTooLarge"]);
  });
});

describe("assertBatchSize (R26)", () => {
  test("a batch at the per-request cap passes", () => {
    expect(assertBatchSize(MAX_FILES_PER_REQUEST)).toEqual([]);
  });

  test("a batch under the per-request cap passes", () => {
    expect(assertBatchSize(1)).toEqual([]);
  });

  test("a batch exceeding the per-request cap is rejected", () => {
    expect(assertBatchSize(MAX_FILES_PER_REQUEST + 1)).toEqual([
      "tooManyFiles",
    ]);
  });

  test("an empty batch passes (emptiness is a separate concern)", () => {
    expect(assertBatchSize(0)).toEqual([]);
  });
});
