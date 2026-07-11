import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sha256File } from "../hashEngine.js";

describe("sha256File", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hash-engine-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("matches the known SHA-256 of a small file's content", async () => {
    const content = "trademark evidence assistant";
    const filePath = join(root, "sample.txt");
    writeFileSync(filePath, content);

    const expected = createHash("sha256").update(content).digest("hex");
    await expect(sha256File(filePath)).resolves.toBe(expected);
  });

  it("produces identical hashes for byte-identical files", async () => {
    writeFileSync(join(root, "a.txt"), "same content");
    writeFileSync(join(root, "b.txt"), "same content");

    const hashA = await sha256File(join(root, "a.txt"));
    const hashB = await sha256File(join(root, "b.txt"));

    expect(hashA).toBe(hashB);
  });

  it("produces different hashes for different content", async () => {
    writeFileSync(join(root, "a.txt"), "content A");
    writeFileSync(join(root, "b.txt"), "content B");

    const hashA = await sha256File(join(root, "a.txt"));
    const hashB = await sha256File(join(root, "b.txt"));

    expect(hashA).not.toBe(hashB);
  });
});
