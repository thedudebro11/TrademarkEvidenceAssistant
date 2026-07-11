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
});
