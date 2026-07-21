import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { HeicDecodeOptions, HeicDecodeResult, HeicDecoder, HeicDecoderCapability } from "./types.js";

/**
 * `heic-decode`, `jpeg-js`, and `libheif-js` are CommonJS packages,
 * loaded lazily via `require` (rather than a static ESM import) so the
 * multi-megabyte libheif WASM module is only ever pulled into memory
 * when a HEIC decode is actually attempted or capability is actually
 * probed — never at server startup just because this file was imported.
 */
const require = createRequire(import.meta.url);

/**
 * Preferred HEIC/HEIF decoder — pure JS + WASM (`libheif-js`, via the
 * `heic-decode` package), never an external process. Selected over the
 * ImageMagick pipeline (`imageMagickDecoder.ts`) because it was tested
 * against a real, previously-corrupted evidence HEIC file
 * (docs/ADR_0005_HEIC_PREVIEWS.md) and produced a visually correct
 * result where ImageMagick's own libheif delegate produced a tiled,
 * fragmented, wrong-color image — same underlying format, different
 * decoder implementation, different (correct) result. That verification
 * was manual (a private evidence photo can't be a committed test
 * fixture); the automated tests for this module mock `heic-decode`
 * itself and prove the plumbing, not visual fidelity.
 *
 * Being WASM rather than a native addon also means this decoder is
 * unaffected by the Windows/WSL native-binary split that governs the
 * rest of this repo's tooling — the same installed package runs
 * identically regardless of which `node` executed it.
 */

let cachedCapability: Promise<HeicDecoderCapability> | null = null;

function decoderVersion(): string {
  try {
    const pkg = require("libheif-js/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function briefErrorReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0].slice(0, 200);
}

async function probe(): Promise<HeicDecoderCapability> {
  try {
    const libheif = require("libheif-js/wasm-bundle");
    await libheif.ready;
    return { available: true, version: decoderVersion(), failureReason: null };
  } catch (err) {
    return { available: false, version: null, failureReason: `libheif-js WASM module failed to initialize: ${briefErrorReason(err)}` };
  }
}

/** Memoized per process, mirroring imageMagickCapability.ts — the WASM module's ability to initialize cannot change while this process is running. */
async function checkCapability(): Promise<HeicDecoderCapability> {
  if (!cachedCapability) cachedCapability = probe();
  return cachedCapability;
}

/** Test-only escape hatch, mirroring resetImageMagickCapabilityCache. */
export function resetLibheifJsCapabilityCache(): void {
  cachedCapability = null;
}

/**
 * Nearest-neighbor downsample of a decoded RGBA buffer to fit within
 * `maxDimension` on the longest edge. Deliberately simple (no
 * bilinear/box filtering): this produces a *preview*, not a
 * re-encode of the evidentiary image — the original HEIC remains the
 * sole authoritative file. Never upscales.
 */
function resizeToFit(data: Uint8ClampedArray, width: number, height: number, maxDimension: number): { data: Uint8ClampedArray; width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  if (scale >= 1) return { data, width, height };

  const newWidth = Math.max(1, Math.round(width * scale));
  const newHeight = Math.max(1, Math.round(height * scale));
  const resized = new Uint8ClampedArray(newWidth * newHeight * 4);
  for (let y = 0; y < newHeight; y++) {
    const srcY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      resized[dstIdx] = data[srcIdx];
      resized[dstIdx + 1] = data[srcIdx + 1];
      resized[dstIdx + 2] = data[srcIdx + 2];
      resized[dstIdx + 3] = data[srcIdx + 3];
    }
  }
  return { data: resized, width: newWidth, height: newHeight };
}

async function decode(absoluteInputPath: string, absoluteOutputDir: string, itemId: string, options: HeicDecodeOptions): Promise<HeicDecodeResult> {
  const finalPath = join(absoluteOutputDir, `${itemId}.jpg`);
  const tmpPath = `${finalPath}.tmp-${randomUUID()}`;

  try {
    const decodeHeic = require("heic-decode");
    const jpeg = require("jpeg-js");

    const inputBuffer = await readFile(absoluteInputPath);
    const { width, height, data } = await decodeHeic({ buffer: inputBuffer });

    if (!width || !height || !data || data.length !== width * height * 4) {
      return { ok: false, outputPath: null, outputFormat: null, mimeType: null, width: null, height: null, reason: "Decoded output failed a basic structural check (unexpected dimensions or buffer size)" };
    }

    const resized = resizeToFit(data, width, height, options.maxDimension);
    const encoded = jpeg.encode({ data: resized.data, width: resized.width, height: resized.height }, Math.round(options.quality * 100));

    // Structural sanity check only (valid JPEG SOI/EOI markers) — this
    // proves the bytes are a well-formed JPEG, never that the pixels are
    // visually correct. Visual correctness was verified manually against
    // a real HEIC file; see the module doc comment above.
    const bytes: Buffer = encoded.data;
    const looksLikeJpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (!looksLikeJpeg) {
      return { ok: false, outputPath: null, outputFormat: null, mimeType: null, width: null, height: null, reason: "Encoded output failed a basic JPEG structural check" };
    }

    await mkdir(absoluteOutputDir, { recursive: true });
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, finalPath);

    return { ok: true, outputPath: finalPath, outputFormat: "jpeg", mimeType: "image/jpeg", width: resized.width, height: resized.height, reason: null };
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    return { ok: false, outputPath: null, outputFormat: null, mimeType: null, width: null, height: null, reason: `libheif-js could not decode this file: ${briefErrorReason(err)}` };
  }
}

export const libheifJsDecoder: HeicDecoder = {
  id: "libheif-js",
  checkCapability,
  decode,
};
