import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Detects whether ImageMagick is installed and can actually decode
 * HEIC/HEIF (docs/ADR_0005_HEIC_PREVIEWS.md) — the presence of the
 * `magick` executable alone proves nothing, since a build without the
 * libheif delegate installs and runs fine but simply can't read HEIC.
 * `magick identify -list format` is the authoritative way to check:
 * ImageMagick only lists a format there if a delegate for it is
 * actually compiled in and available.
 */
export interface ImageMagickCapability {
  available: boolean;
  version: string | null;
  heicReadSupported: boolean;
  webpWriteSupported: boolean;
  jpegWriteSupported: boolean;
  /** A short, safe-to-display reason `available`/read/write support is false — never a raw stack trace or full command line. `null` when everything needed is supported. */
  failureReason: string | null;
}

const PROBE_TIMEOUT_MS = 10_000;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;

let cachedCapability: Promise<ImageMagickCapability> | null = null;

/** Never invoked through a shell (execFile, not exec) and never receives interpolated/untrusted input — both calls here use a fixed, hardcoded argument list. */
async function runMagick(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("magick", args, {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  });
  return stdout;
}

function parseVersion(stdout: string): string | null {
  const match = stdout.match(/Version:\s*ImageMagick\s+(\S+)/i);
  return match ? match[1] : null;
}

const MODE_TOKEN_PATTERN = /^[rw+-]{2,3}$/i;

/**
 * Scans `magick identify -list format`'s tabular output for a row whose
 * format matches one of `formatNames` and whose mode column contains
 * `modeChar` ('r' = readable, 'w' = writable). The mode token (e.g.
 * `r--`, `rw+`) is usually the field immediately after the format name
 * (`FORMAT MODE DESCRIPTION`), but some ImageMagick builds insert a
 * separate MODULE column first when it differs from the format name
 * (`FORMAT MODULE MODE DESCRIPTION`) — confirmed by running the real
 * `magick identify -list format` against a real Windows ImageMagick
 * 7.1.2 install, whose HEIC/HEIF rows have no MODULE column at all
 * (`     HEIC  r--   High Efficiency Image Format (1.21.2)`), unlike
 * this file's own pre-existing test fixtures, which assumed MODULE is
 * always present. Scanning a couple of fields for the mode-token shape,
 * rather than trusting one fixed index, handles both layouts.
 */
function formatSupports(listOutput: string, formatNames: string[], modeChar: "r" | "w"): boolean {
  const wanted = new Set(formatNames.map((f) => f.toUpperCase()));
  for (const rawLine of listOutput.split("\n")) {
    const fields = rawLine.trim().split(/\s+/);
    if (fields.length < 2) continue;
    const format = fields[0].replace(/\*$/, "").toUpperCase();
    if (!wanted.has(format)) continue;
    const modeField = fields.slice(1, 3).find((f) => MODE_TOKEN_PATTERN.test(f));
    if (modeField && modeField.toLowerCase().includes(modeChar)) return true;
  }
  return false;
}

function briefErrorReason(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "ENOENT") {
    return "command not found";
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0].slice(0, 200);
}

async function detect(): Promise<ImageMagickCapability> {
  const unavailable = (reason: string): ImageMagickCapability => ({
    available: false,
    version: null,
    heicReadSupported: false,
    webpWriteSupported: false,
    jpegWriteSupported: false,
    failureReason: reason,
  });

  let versionOutput: string;
  try {
    versionOutput = await runMagick(["-version"]);
  } catch (err) {
    return unavailable(`ImageMagick ("magick") was not found or could not be run: ${briefErrorReason(err)}`);
  }
  const version = parseVersion(versionOutput);

  let listOutput: string;
  try {
    listOutput = await runMagick(["identify", "-list", "format"]);
  } catch (err) {
    return {
      available: true,
      version,
      heicReadSupported: false,
      webpWriteSupported: false,
      jpegWriteSupported: false,
      failureReason: `ImageMagick is installed but "magick identify -list format" failed: ${briefErrorReason(err)}`,
    };
  }

  const heicReadSupported = formatSupports(listOutput, ["HEIC", "HEIF"], "r");
  const webpWriteSupported = formatSupports(listOutput, ["WEBP"], "w");
  const jpegWriteSupported = formatSupports(listOutput, ["JPEG", "JPG"], "w");

  let failureReason: string | null = null;
  if (!heicReadSupported) {
    failureReason = "The installed ImageMagick build does not list HEIC/HEIF as a readable format — it may be missing the libheif delegate.";
  } else if (!webpWriteSupported && !jpegWriteSupported) {
    failureReason = "The installed ImageMagick build can read HEIC/HEIF but cannot write WebP or JPEG.";
  }

  return { available: true, version, heicReadSupported, webpWriteSupported, jpegWriteSupported, failureReason };
}

/**
 * Memoized — ImageMagick's installed capability cannot change while
 * this server process is running, so the two probe commands
 * (`-version`, `identify -list format`) only ever actually run once per
 * process, no matter how many previews are generated.
 */
export function detectImageMagickCapability(): Promise<ImageMagickCapability> {
  if (!cachedCapability) {
    cachedCapability = detect();
  }
  return cachedCapability;
}

/** Test-only escape hatch: forces the next `detectImageMagickCapability()` call to re-probe rather than reuse a cached result. */
export function resetImageMagickCapabilityCache(): void {
  cachedCapability = null;
}
