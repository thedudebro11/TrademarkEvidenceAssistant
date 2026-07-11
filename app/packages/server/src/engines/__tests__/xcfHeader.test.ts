import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readXcfDimensions } from "../xcfHeader.js";

// Byte layout verified against a real GIMP-produced .xcf file in this
// project's own evidence set (workspaces/Fatletic/evidence/*.xcf) during
// Phase 2 development — see docs/IMPLEMENTATION_PLAN.md Phase 2 notes.
function buildXcfHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(22);
  buffer.write("gimp xcf ", 0, "ascii");
  buffer.write("v011\0", 9, "ascii");
  buffer.writeUInt32BE(width, 14);
  buffer.writeUInt32BE(height, 18);
  return buffer;
}

describe("readXcfDimensions", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "xcf-header-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads width and height from a valid XCF header", () => {
    const filePath = join(root, "design.xcf");
    writeFileSync(filePath, buildXcfHeader(6000, 5000));

    expect(readXcfDimensions(filePath)).toEqual({ width: 6000, height: 5000 });
  });

  it("returns null for a file with the wrong signature", () => {
    const filePath = join(root, "not-xcf.xcf");
    writeFileSync(filePath, Buffer.from("not an xcf file at all"));

    expect(readXcfDimensions(filePath)).toBeNull();
  });

  it("returns null for a truncated file", () => {
    const filePath = join(root, "truncated.xcf");
    writeFileSync(filePath, Buffer.from("gimp xcf "));

    expect(readXcfDimensions(filePath)).toBeNull();
  });
});
