import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { expectRejects } from "../../../test-support/assertions";
import {
  MAX_INPUT_PIXELS,
  PREVIEW_MAX_EDGE,
  THUMB_MAX_EDGE,
} from "../constants";
import { processImage } from "../pipeline";

const SOURCE_WIDTH = 800;
const SOURCE_HEIGHT = 600;

/** A solid-color JPEG fixture, larger than either derivative's max edge. */
async function makeJpegFixture(
  width = SOURCE_WIDTH,
  height = SOURCE_HEIGHT,
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .jpeg()
    .toBuffer();
}

/** A JPEG fixture carrying EXIF GPS (and other) location metadata. */
async function makeJpegFixtureWithGpsExif(): Promise<Buffer> {
  return sharp({
    create: {
      width: SOURCE_WIDTH,
      height: SOURCE_HEIGHT,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .withExif({
      IFD0: { Copyright: "test fixture" },
      // sharp writes GPS tags under IFD3 (see its withExif() JSDoc example) —
      // there is no dedicated top-level "GPS" group.
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "40/1 26/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "79/1 58/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

describe("processImage — happy path (R11)", () => {
  test("a valid JPEG yields original + thumb + preview with captured dimensions", async () => {
    const source = await makeJpegFixture();

    const result = await processImage(source, "image/jpeg");

    expect(result.width).toBe(SOURCE_WIDTH);
    expect(result.height).toBe(SOURCE_HEIGHT);
    expect(result.original.length).toBeGreaterThan(0);
    expect(result.thumb.length).toBeGreaterThan(0);
    expect(result.preview.length).toBeGreaterThan(0);
  });

  test("derivatives are resized to fit inside their max edge, source is not", async () => {
    const source = await makeJpegFixture();

    const result = await processImage(source, "image/jpeg");

    const thumbMeta = await sharp(result.thumb).metadata();
    const previewMeta = await sharp(result.preview).metadata();
    const originalMeta = await sharp(result.original).metadata();

    expect(
      Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0),
    ).toBeLessThanOrEqual(THUMB_MAX_EDGE);
    expect(
      Math.max(previewMeta.width ?? 0, previewMeta.height ?? 0),
    ).toBeLessThanOrEqual(PREVIEW_MAX_EDGE);
    // The source (800x600) is smaller than PREVIEW_MAX_EDGE (1024) on its
    // longest edge, so the original re-encode is left at source dimensions —
    // re-encoding never upscales.
    expect(originalMeta.width).toBe(SOURCE_WIDTH);
    expect(originalMeta.height).toBe(SOURCE_HEIGHT);
  });
});

describe("processImage — location-metadata strip (R10, AE5)", () => {
  test("EXIF GPS present on the input is absent from every output blob", async () => {
    const source = await makeJpegFixtureWithGpsExif();
    const sourceMeta = await sharp(source).metadata();
    expect(sourceMeta.exif).toBeDefined();

    const result = await processImage(source, "image/jpeg");

    const originalMeta = await sharp(result.original).metadata();
    const thumbMeta = await sharp(result.thumb).metadata();
    const previewMeta = await sharp(result.preview).metadata();

    expect(originalMeta.exif).toBeUndefined();
    expect(thumbMeta.exif).toBeUndefined();
    expect(previewMeta.exif).toBeUndefined();
  });
});

describe("processImage — decompression-bomb rejection (R9)", () => {
  test("an image whose decoded pixel count exceeds MAX_INPUT_PIXELS is rejected", async () => {
    // 5000 * 5000 = 25,000,000 > MAX_INPUT_PIXELS (24,000,000).
    const bombWidth = 5000;
    const bombHeight = 5000;
    expect(bombWidth * bombHeight).toBeGreaterThan(MAX_INPUT_PIXELS);
    const bomb = await makeJpegFixture(bombWidth, bombHeight);

    await expectRejects(() => processImage(bomb, "image/jpeg"));
  });
});

describe("processImage — corrupt input rejection", () => {
  test("a truncated/corrupt buffer is rejected without throwing past the boundary", async () => {
    const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);

    await expectRejects(() => processImage(corrupt, "image/jpeg"));
  });

  test("an empty buffer is rejected", async () => {
    await expectRejects(() => processImage(Buffer.alloc(0), "image/jpeg"));
  });
});
