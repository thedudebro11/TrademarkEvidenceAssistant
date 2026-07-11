import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFiles } from "../scannerEngine.js";

describe("discoverFiles", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "scanner-engine-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("discovers files recursively, sorted by relative path", () => {
    mkdirSync(join(root, "nested", "deeper"), { recursive: true });
    writeFileSync(join(root, "b.txt"), "b");
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "nested", "c.txt"), "c");
    writeFileSync(join(root, "nested", "deeper", "d.txt"), "d");

    const files = discoverFiles(root);

    expect(files.map((f) => f.relativePath)).toEqual([
      "a.txt",
      "b.txt",
      "nested/c.txt",
      "nested/deeper/d.txt",
    ]);
  });

  it("skips ignored directory names (defensive per docs/RISKS.md #5)", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "mind.mv2.lock"), "");
    mkdirSync(join(root, "generated"), { recursive: true });
    writeFileSync(join(root, "generated", "app.db"), "");
    writeFileSync(join(root, "real_evidence.jpg"), "jpeg-bytes");

    const files = discoverFiles(root);

    expect(files.map((f) => f.relativePath)).toEqual(["real_evidence.jpg"]);
  });

  it("skips ignored directories case-insensitively", () => {
    mkdirSync(join(root, "Generated"), { recursive: true });
    writeFileSync(join(root, "Generated", "app.db"), "");
    writeFileSync(join(root, "keep.jpg"), "x");

    const files = discoverFiles(root);

    expect(files.map((f) => f.relativePath)).toEqual(["keep.jpg"]);
  });

  it("reports file size and filesystem timestamps", () => {
    writeFileSync(join(root, "sized.txt"), "12345");

    const [file] = discoverFiles(root);

    expect(file.fileSize).toBe(5);
    expect(new Date(file.fsCreatedAt).getTime()).not.toBeNaN();
    expect(new Date(file.fsModifiedAt).getTime()).not.toBeNaN();
  });

  it("handles filenames with spaces and parentheses (real evidence set has these)", () => {
    mkdirSync(join(root, "Proof Files"), { recursive: true });
    writeFileSync(join(root, "Proof Files", "13080129_20613013_proof (1).pdf"), "pdf");

    const files = discoverFiles(root);

    expect(files.map((f) => f.relativePath)).toEqual([
      "Proof Files/13080129_20613013_proof (1).pdf",
    ]);
  });
});
