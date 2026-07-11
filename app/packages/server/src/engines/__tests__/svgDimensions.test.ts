import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSvgDimensions } from "../svgDimensions.js";

describe("readSvgDimensions", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "svg-dimensions-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads explicit pixel width/height attributes", () => {
    const filePath = join(root, "px.svg");
    writeFileSync(filePath, `<svg width="120px" height="80px" xmlns="http://www.w3.org/2000/svg"></svg>`);

    expect(readSvgDimensions(filePath)).toEqual({ width: 120, height: 80 });
  });

  it("falls back to viewBox when width/height use non-pixel units (real evidence uses mm)", () => {
    // Mirrors workspaces/Fatletic/evidence/bitmap.svg, which declares
    // width="1833.0333mm" height="1535.6418mm" — not pixels.
    const filePath = join(root, "mm.svg");
    writeFileSync(
      filePath,
      `<?xml version="1.0"?>\n<svg width="1833.0333mm" height="1535.6418mm" viewBox="0 0 1833.0333 1535.6418" xmlns="http://www.w3.org/2000/svg"></svg>`,
    );

    expect(readSvgDimensions(filePath)).toEqual({ width: 1833, height: 1536 });
  });

  it("returns null when neither dimensions nor viewBox are present", () => {
    const filePath = join(root, "bare.svg");
    writeFileSync(filePath, `<svg xmlns="http://www.w3.org/2000/svg"></svg>`);

    expect(readSvgDimensions(filePath)).toBeNull();
  });

  it("returns null for a non-SVG file", () => {
    const filePath = join(root, "not-svg.svg");
    writeFileSync(filePath, "plain text, not xml at all");

    expect(readSvgDimensions(filePath)).toBeNull();
  });
});
