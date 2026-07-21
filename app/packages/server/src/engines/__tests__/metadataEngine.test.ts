import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { extractMetadata } from "../metadataEngine.js";
import { REPO_ROOT } from "../../config/repoRoot.js";

const GOLDEN = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("extractMetadata", () => {
  it("extracts JPEG dimensions", async () => {
    const result = await extractMetadata(join(GOLDEN, "product_photo.jpg"), "jpg");
    expect(result.width).toBe(60);
    expect(result.height).toBe(40);
    expect(result.pageCount).toBeNull();
  });

  it("extracts PNG dimensions", async () => {
    const result = await extractMetadata(join(GOLDEN, "social_post_export.png"), "png");
    expect(result.width).toBe(45);
    expect(result.height).toBe(45);
  });

  it("extracts PSD dimensions from the real 26-byte header", async () => {
    const result = await extractMetadata(join(GOLDEN, "logo_source.psd"), "psd");
    expect(result.width).toBe(40);
    expect(result.height).toBe(30);
  });

  it("extracts PDF page count", async () => {
    const result = await extractMetadata(join(GOLDEN, "printful_invoice.pdf"), "pdf");
    expect(result.pageCount).toBe(2);
    expect(result.width).toBeNull();
  });

  it("returns nulls (fails soft) for an unsupported extension", async () => {
    const result = await extractMetadata(join(GOLDEN, "video_placeholder.mp4"), "mp4");
    expect(result).toEqual({ width: null, height: null, pageCount: null });
  });

  it("returns nulls (fails soft) for a nonexistent file rather than throwing", async () => {
    const result = await extractMetadata(join(GOLDEN, "does_not_exist.jpg"), "jpg");
    expect(result).toEqual({ width: null, height: null, pageCount: null });
  });

  // The HEIC/HEIF success path (real EXIF/GPS/orientation parsing, with
  // `magick` mocked) is covered by heicExifEngine.test.ts — this file
  // never mocks child_process, so it only exercises the fail-soft path
  // here, which is genuinely representative of any environment without
  // ImageMagick installed (this one included).
  it(
    "29. HEIC extraction fails soft (never throws, dimensions null) on a nonexistent file — whether or not ImageMagick is installed in this environment, JPEG/PNG/PDF extraction above is unaffected by the new branch",
    async () => {
      // This machine may have a real ImageMagick install (unlike when this
      // test was first written) — heicExifEngine.ts then genuinely spawns
      // `magick identify` against a file that does not exist, which is
      // slower than the instant ENOENT an absent binary produces, so this
      // needs more than Vitest's default 5s. Deliberately still not
      // mocking child_process — the point of this file is to prove the
      // real fail-soft path end-to-end, present-binary or not.
      const result = await extractMetadata(join(GOLDEN, "does_not_exist.heic"), "heic", "IMG_20260717_020251.heic");
      expect(result.width).toBeNull();
      expect(result.exifDateTimeOriginal).toBeNull();
      // Filename inference runs independently of ImageMagick and must
      // still work even when the EXIF extractor itself fails.
      expect(result.filenameInferredDate).toBe("2026-07-17T02:02:51");
    },
    20_000,
  );
});
