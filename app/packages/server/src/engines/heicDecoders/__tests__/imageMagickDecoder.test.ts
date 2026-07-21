import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `execFile` is bare vi.fn() here, so it lacks Node's real execFile's
// `util.promisify.custom` implementation (which is what makes
// `promisify(execFile)` resolve `{ stdout, stderr }` instead of just the
// first callback argument). imageMagickDecoder.ts and
// imageMagickCapability.ts both call execFile through `promisify`, so
// the mock must supply the same custom symbol.
vi.mock("node:child_process", () => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for("nodejs.util.promisify.custom")] = (cmd: string, args: string[], opts: unknown) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, opts, (err: Error | null, stdout?: string, stderr?: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { execFile };
});

import { imageMagickDecoder } from "../imageMagickDecoder.js";
import { resetImageMagickCapabilityCache } from "../../imageMagickCapability.js";

type ExecFileCallback = (error: (Error & { code?: string }) | null, stdout?: string, stderr?: string) => void;
const mockedExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

const VERSION_STDOUT = "Version: ImageMagick 7.1.1-29 Q16-HDRI x64 00000";
const FULL_FORMAT_LIST = "  HEIC* HEIC   r--   Highly Efficient Image Format\n  WEBP  WEBP   rw+   WebP Image Format\n  JPEG  JPEG   rw+   JPEG\n";
const NO_HEIC_FORMAT_LIST = "  WEBP  WEBP   rw+   WebP Image Format\n";

function installMagickMock(formatList = FULL_FORMAT_LIST) {
  mockedExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
    if (args.includes("-version")) return cb(null, VERSION_STDOUT, "");
    if (args.includes("identify") && args.includes("-list")) return cb(null, formatList, "");
    const outputPath = args[args.length - 1];
    writeFileSync(outputPath, "fake-preview-bytes");
    cb(null, "", "");
  });
}

describe("imageMagickDecoder", () => {
  let workDir: string;

  beforeEach(() => {
    resetImageMagickCapabilityCache();
    vi.clearAllMocks();
    workDir = mkdtempSync(join(tmpdir(), "imagemagick-decoder-test-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports its id as "imagemagick"', () => {
    expect(imageMagickDecoder.id).toBe("imagemagick");
  });

  it("checkCapability reports unavailable with a safe reason when magick has no HEIC delegate", async () => {
    installMagickMock(NO_HEIC_FORMAT_LIST);
    const cap = await imageMagickDecoder.checkCapability();
    expect(cap.available).toBe(false);
    expect(cap.failureReason).toMatch(/HEIC\/HEIF/);
  });

  it("decode() writes to a temp path and renames into the final WebP path on success", async () => {
    installMagickMock();
    const inputPath = join(workDir, "input.heic");
    writeFileSync(inputPath, "not-really-heic");

    const result = await imageMagickDecoder.decode(inputPath, workDir, "item-1", { maxDimension: 2400, quality: 0.88 });
    expect(result.ok).toBe(true);
    expect(result.outputFormat).toBe("webp");
    expect(result.mimeType).toBe("image/webp");
    expect(result.outputPath).toBe(join(workDir, "item-1.webp"));
    expect(existsSync(result.outputPath!)).toBe(true);

    // never left the tmp file behind
    const [, args] = mockedExecFile.mock.calls[mockedExecFile.mock.calls.length - 1];
    const tmpArg = args[args.length - 1] as string;
    expect(existsSync(tmpArg)).toBe(false);
  });

  it("decode() never invokes a shell and passes the input/output paths as their own argv elements", async () => {
    installMagickMock();
    const inputPath = join(workDir, "weird; rm -rf.heic");
    writeFileSync(inputPath, "not-really-heic");

    await imageMagickDecoder.decode(inputPath, workDir, "item-2", { maxDimension: 2400, quality: 0.88 });
    const [cmd, args] = mockedExecFile.mock.calls[mockedExecFile.mock.calls.length - 1];
    expect(cmd).toBe("magick");
    expect(Array.isArray(args)).toBe(true);
    expect(args[0]).toBe(inputPath);
  });

  it("decode() returns a safe failure reason, never a raw command line, when conversion crashes", async () => {
    mockedExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
      if (args.includes("-version")) return cb(null, VERSION_STDOUT, "");
      if (args.includes("identify") && args.includes("-list")) return cb(null, FULL_FORMAT_LIST, "");
      cb(new Error("simulated ImageMagick crash"));
    });
    const inputPath = join(workDir, "input.heic");
    writeFileSync(inputPath, "not-really-heic");

    const result = await imageMagickDecoder.decode(inputPath, workDir, "item-3", { maxDimension: 2400, quality: 0.88 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ImageMagick reported a conversion error");
    expect(result.reason).not.toMatch(/magick |--limit|C:\\|\/home\//);
  });
});
