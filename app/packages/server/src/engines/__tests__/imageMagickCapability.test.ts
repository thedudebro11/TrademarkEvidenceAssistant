import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";

// `execFile` is bare vi.fn() here, so it lacks Node's real execFile's
// `util.promisify.custom` implementation (which is what makes
// `promisify(execFile)` resolve `{ stdout, stderr }` instead of just the
// first callback argument). imageMagickCapability.ts calls execFile
// through `promisify`, so the mock must supply the same custom symbol,
// or every `await execFileAsync(...)` silently resolves to a bare
// string instead of `{ stdout, stderr }`.
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

import { detectImageMagickCapability, resetImageMagickCapabilityCache } from "../imageMagickCapability.js";

type ExecFileCallback = (error: (Error & { code?: string }) | null, stdout?: string, stderr?: string) => void;
const mockedExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function mockExecFileImpl(handler: (args: string[]) => { stdout: string } | Error) {
  mockedExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
    const result = handler(args);
    if (result instanceof Error) cb(result);
    else cb(null, result.stdout, "");
  });
}

beforeEach(() => {
  resetImageMagickCapabilityCache();
  vi.clearAllMocks();
});

describe("detectImageMagickCapability", () => {
  it("reports unavailable when magick is not found (ENOENT)", async () => {
    mockExecFileImpl(() => {
      const err = new Error("not found") as Error & { code?: string };
      err.code = "ENOENT";
      return err;
    });
    const cap = await detectImageMagickCapability();
    expect(cap.available).toBe(false);
    expect(cap.heicReadSupported).toBe(false);
    expect(cap.failureReason).toMatch(/not found or could not be run/i);
  });

  it("18. does not assume magick presence means HEIC support — reports heicReadSupported=false when the format list lacks HEIC/HEIF", async () => {
    mockExecFileImpl((args) => {
      if (args.includes("-version")) return { stdout: "Version: ImageMagick 7.1.1-29 Q16-HDRI x64 00000" };
      return { stdout: "  WEBP  WEBP   rw+   WebP Image Format\n  JPEG  JPEG   rw+   JPEG\n" };
    });
    const cap = await detectImageMagickCapability();
    expect(cap.available).toBe(true);
    expect(cap.version).toBe("7.1.1-29");
    expect(cap.heicReadSupported).toBe(false);
    expect(cap.failureReason).toMatch(/HEIC\/HEIF/);
  });

  it("parses a real-world 3-column format line with no separate MODULE column (observed on ImageMagick 7.1.2-24 for Windows)", async () => {
    mockExecFileImpl((args) => {
      if (args.includes("-version")) return { stdout: "Version: ImageMagick 7.1.2-24 Q16-HDRI x64 00000" };
      return {
        stdout: [
          "     HEIC  r--   High Efficiency Image Format (1.21.2)",
          "     HEIF  r--   High Efficiency Image Format (1.21.2)",
          "     WEBP* rw+   WebP Image Format (libwebp 1.6.0 [0210])",
          "     JPEG* rw-   Joint Photographic Experts Group JFIF format (libjpeg-turbo 3.1.3)",
        ].join("\n"),
      };
    });
    const cap = await detectImageMagickCapability();
    expect(cap.heicReadSupported).toBe(true);
    expect(cap.webpWriteSupported).toBe(true);
    expect(cap.jpegWriteSupported).toBe(true);
    expect(cap.failureReason).toBeNull();
  });

  it("reports full capability when HEIC read and WebP write are both listed", async () => {
    mockExecFileImpl((args) => {
      if (args.includes("-version")) return { stdout: "Version: ImageMagick 7.1.1-29 Q16-HDRI x64 00000" };
      return { stdout: "  HEIC* HEIC   r--   Highly Efficient Image Format\n  WEBP  WEBP   rw+   WebP Image Format\n" };
    });
    const cap = await detectImageMagickCapability();
    expect(cap.heicReadSupported).toBe(true);
    expect(cap.webpWriteSupported).toBe(true);
    expect(cap.failureReason).toBeNull();
  });

  it("falls back to a JPEG-only failure reason when HEIC is readable but no writable output format exists", async () => {
    mockExecFileImpl((args) => {
      if (args.includes("-version")) return { stdout: "Version: ImageMagick 7.1.1-29 Q16-HDRI x64 00000" };
      return { stdout: "  HEIC* HEIC   r--   Highly Efficient Image Format\n" };
    });
    const cap = await detectImageMagickCapability();
    expect(cap.heicReadSupported).toBe(true);
    expect(cap.webpWriteSupported).toBe(false);
    expect(cap.jpegWriteSupported).toBe(false);
    expect(cap.failureReason).toMatch(/cannot write WebP or JPEG/i);
  });

  it("memoizes — probes at most twice total no matter how many times it's called", async () => {
    mockExecFileImpl((args) => (args.includes("-version") ? { stdout: "Version: ImageMagick 7.1.1-29 Q16-HDRI x64 00000" } : { stdout: "  HEIC* HEIC r-- x\n  WEBP WEBP rw+ x\n" }));
    await detectImageMagickCapability();
    await detectImageMagickCapability();
    await detectImageMagickCapability();
    expect(mockedExecFile).toHaveBeenCalledTimes(2);
  });

  it("never invokes a shell and never passes a single concatenated command string — args are always an array", async () => {
    mockExecFileImpl(() => ({ stdout: "Version: ImageMagick 7.1.1-29 Q16-HDRI x64 00000" }));
    await detectImageMagickCapability();
    const [, args] = mockedExecFile.mock.calls[0];
    expect(Array.isArray(args)).toBe(true);
  });
});
