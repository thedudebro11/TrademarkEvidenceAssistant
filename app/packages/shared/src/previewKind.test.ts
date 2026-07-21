import { describe, expect, it } from "vitest";
import { getPreviewKind } from "./previewKind.js";

describe("getPreviewKind", () => {
  it("classifies standard raster images and svg as image", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "svg"]) {
      expect(getPreviewKind(ext)).toBe("image");
    }
  });

  it("classifies pdf as pdf", () => {
    expect(getPreviewKind("pdf")).toBe("pdf");
  });

  it("1/2. classifies heic and heif as their own 'heic' kind, distinct from plain 'image'", () => {
    expect(getPreviewKind("heic")).toBe("heic");
    expect(getPreviewKind("heif")).toBe("heic");
    expect(getPreviewKind("HEIC")).toBe("heic");
    expect(getPreviewKind(".heif")).toBe("heic");
  });

  it("classifies every video container as video, regardless of whether the browser can actually decode the codec inside", () => {
    for (const ext of ["mp4", "webm", "mkv", "mov", "m4v", "avi"]) {
      expect(getPreviewKind(ext)).toBe("video");
    }
  });

  it("classifies plain text formats as text", () => {
    for (const ext of ["txt", "csv", "json", "md"]) {
      expect(getPreviewKind(ext)).toBe("text");
    }
  });

  it("falls back to unsupported for formats with no viewer at all", () => {
    for (const ext of ["psd", "xcf", "ai", "zip"]) {
      expect(getPreviewKind(ext)).toBe("unsupported");
    }
  });

  it("is case-insensitive and tolerates a leading dot", () => {
    expect(getPreviewKind("MKV")).toBe("video");
    expect(getPreviewKind(".mkv")).toBe("video");
  });
});
