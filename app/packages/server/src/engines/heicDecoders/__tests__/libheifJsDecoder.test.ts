import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libheifJsDecoder, resetLibheifJsCapabilityCache } from "../libheifJsDecoder.js";

/**
 * No committed HEIC fixture (real or synthetic) is used here — per the
 * decoder-independence spec, an automated test must never claim to
 * verify visual fidelity, and a private evidence photo can never be a
 * committed fixture. Visual correctness against a real file was
 * verified manually; see docs/ADR_0005_HEIC_PREVIEWS.md and this
 * module's doc comment. What these tests genuinely prove, without
 * mocking `heic-decode`/`jpeg-js`/`libheif-js` at all: the real WASM
 * module actually initializes in this environment, and the decoder's
 * own error handling (safe failure reason, no orphaned temp file) is
 * correct for input that is provably not a valid HEIC file.
 */
describe("libheifJsDecoder", () => {
  let workDir: string;

  beforeEach(() => {
    resetLibheifJsCapabilityCache();
    workDir = mkdtempSync(join(tmpdir(), "libheif-js-decoder-test-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports its id as "libheif-js"', () => {
    expect(libheifJsDecoder.id).toBe("libheif-js");
  });

  it("checkCapability actually initializes the real libheif-js WASM module and reports a version", async () => {
    const cap = await libheifJsDecoder.checkCapability();
    expect(cap.available).toBe(true);
    expect(cap.failureReason).toBeNull();
    expect(typeof cap.version).toBe("string");
    expect(cap.version).not.toBe("");
  }, 20_000);

  it("checkCapability is memoized — a second call resolves to the exact same object, not a fresh probe", async () => {
    const first = await libheifJsDecoder.checkCapability();
    const second = await libheifJsDecoder.checkCapability();
    expect(second).toBe(first);
  }, 20_000);

  it("decode() fails safely, with no orphaned temp file, when the input is not a valid HEIC container", async () => {
    const inputPath = join(workDir, "not-a-heic.heic");
    writeFileSync(inputPath, "this is definitely not a HEIC file");

    const result = await libheifJsDecoder.decode(inputPath, workDir, "item-1", { maxDimension: 2400, quality: 0.88 });

    expect(result.ok).toBe(false);
    expect(result.outputPath).toBeNull();
    expect(result.reason).toBeTruthy();
    expect(result.reason).not.toMatch(/at Object\.|node_modules|\.js:\d+:\d+/); // never a raw stack trace

    const leftoverFiles = existsSync(workDir) ? readdirSync(workDir) : [];
    expect(leftoverFiles.filter((f) => f.includes(".tmp-"))).toEqual([]);
  }, 20_000);

  it("decode() fails safely on a truncated/empty buffer rather than throwing out of the function", async () => {
    const inputPath = join(workDir, "empty.heic");
    writeFileSync(inputPath, Buffer.alloc(0));

    const result = await libheifJsDecoder.decode(inputPath, workDir, "item-2", { maxDimension: 2400, quality: 0.88 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  }, 20_000);
});
