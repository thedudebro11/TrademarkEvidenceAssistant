import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";

// `execFile` is bare vi.fn() here, so it lacks Node's real execFile's
// `util.promisify.custom` implementation (which is what makes
// `promisify(execFile)` resolve `{ stdout, stderr }` instead of just the
// first callback argument). heicExifEngine.ts calls execFile through
// `promisify`, so the mock must supply the same custom symbol, or every
// `await execFileAsync(...)` silently resolves to a bare string instead
// of `{ stdout, stderr }` and every test here fails soft into all-null
// output without ever exercising the parsing logic under test.
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

import { extractHeicExifMetadata } from "../heicExifEngine.js";

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;
const mockedExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const SEP = "\x1f";

function mockStdout(stdout: string) {
  mockedExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => cb(null, stdout, ""));
}

describe("extractHeicExifMetadata", () => {
  // Without this, `mockedExecFile.mock.calls` accumulates across every
  // `it()` in this file, so `mock.calls[0]` in a later test silently
  // refers to an earlier test's call instead of its own.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("8. extracts dimensions and EXIF/GPS/color fields from a well-formed identify response", async () => {
    mockStdout(["3024", "4032", "2026:07:17 02:02:51", "2026:07:17 02:02:51", "Google", "Pixel 8", "6", "37/1,46/1,3000/100", "N", "122/1,25/1,1200/100", "W", "Display P3"].join(SEP));
    const result = await extractHeicExifMetadata("/fake/IMG_20260717_020251.heic");
    expect(result.width).toBe(3024);
    expect(result.height).toBe(4032);
    expect(result.exifDateTimeOriginal).toBe("2026:07:17 02:02:51");
    expect(result.cameraMake).toBe("Google");
    expect(result.cameraModel).toBe("Pixel 8");
    expect(result.orientation).toBe(6);
    expect(result.colorProfile).toBe("Display P3");
    expect(result.gpsLatitude).toBeCloseTo(37.775, 3);
    expect(result.gpsLongitude).toBeCloseTo(-122.42, 3);
  });

  it("12. missing EXIF fields become null, never an invented value", async () => {
    mockStdout(["100", "200", "", "", "", "", "", "", "", "", "", ""].join(SEP));
    const result = await extractHeicExifMetadata("/fake/no_exif.heic");
    expect(result.width).toBe(100);
    expect(result.height).toBe(200);
    expect(result.exifDateTimeOriginal).toBeNull();
    expect(result.cameraMake).toBeNull();
    expect(result.gpsLatitude).toBeNull();
    expect(result.gpsLongitude).toBeNull();
    expect(result.colorProfile).toBeNull();
  });

  it("9. a failed/corrupt-file identify call returns every field null rather than throwing", async () => {
    mockedExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => cb(new Error("identify failed")));
    await expect(extractHeicExifMetadata("/fake/corrupt.heic")).resolves.toMatchObject({
      width: null,
      height: null,
      exifDateTimeOriginal: null,
      gpsLatitude: null,
    });
  });

  it("19. malicious filename cannot inject shell arguments — the path is passed as its own argv element, not concatenated", async () => {
    mockStdout(["1", "1", "", "", "", "", "", "", "", "", "", ""].join(SEP));
    await extractHeicExifMetadata("/fake/'; rm -rf /; echo '.heic");
    const [cmd, args] = mockedExecFile.mock.calls[0];
    expect(cmd).toBe("magick");
    expect(Array.isArray(args)).toBe(true);
    expect(args[args.length - 1]).toBe("/fake/'; rm -rf /; echo '.heic");
  });

  it("an incomplete GPS triplet (not exactly 3 rational parts) is treated as unavailable rather than partially parsed", async () => {
    mockStdout(["10", "10", "", "", "", "", "", "37/1,46/1", "N", "", "", ""].join(SEP));
    const result = await extractHeicExifMetadata("/fake/bad_gps.heic");
    expect(result.gpsLatitude).toBeNull();
  });
});
