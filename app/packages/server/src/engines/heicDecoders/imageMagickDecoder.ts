import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { detectImageMagickCapability } from "../imageMagickCapability.js";
import type { HeicDecodeOptions, HeicDecodeResult, HeicDecoder, HeicDecoderCapability } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * ImageMagick-backed decoder — kept as a manually-selectable alternate
 * decoder only (see `heicDecoders/index.ts`), never the automatic
 * default. It was the original (and, until this change, only) HEIC
 * preview decoder, and was found to produce a visually corrupted
 * (tiled/fragmented, wrong-color) result for a real Android-camera HEIC
 * file even though the `magick` process exits 0 and writes a
 * structurally valid image — see docs/ADR_0005_HEIC_PREVIEWS.md and
 * `libheifJsDecoder.ts`'s doc comment. Retained rather than deleted
 * because it may still work correctly for other HEIC encoders/files,
 * and because "Retry with Alternate Decoder" needs a second decoder to
 * retry with.
 */

const CONVERT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;

function safeFailureReason(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { killed?: boolean; signal?: string | null; code?: unknown };
    if (e.killed || e.signal) return "Conversion timed out";
    if (e.code === "ENOENT") return "ImageMagick could not be run";
  }
  return "ImageMagick reported a conversion error";
}

async function checkCapability(): Promise<HeicDecoderCapability> {
  const cap = await detectImageMagickCapability();
  if (!cap.available || !cap.heicReadSupported || (!cap.webpWriteSupported && !cap.jpegWriteSupported)) {
    return { available: false, version: cap.version, failureReason: cap.failureReason ?? "HEIC preview generation is not available on this server" };
  }
  return { available: true, version: cap.version, failureReason: null };
}

/**
 * Never invoked through a shell (execFile, array args) and never
 * receives a filename built by string concatenation. Writes to a
 * randomized temp path first and renames into place only on success.
 */
async function decode(absoluteInputPath: string, absoluteOutputDir: string, itemId: string, options: HeicDecodeOptions): Promise<HeicDecodeResult> {
  const cap = await detectImageMagickCapability();
  if (!cap.available || !cap.heicReadSupported || (!cap.webpWriteSupported && !cap.jpegWriteSupported)) {
    return { ok: false, outputPath: null, outputFormat: null, mimeType: null, width: null, height: null, reason: cap.failureReason ?? "HEIC preview generation is not available on this server" };
  }

  const outputExtension: "webp" | "jpg" = cap.webpWriteSupported ? "webp" : "jpg";
  const outputFormat: "webp" | "jpeg" = cap.webpWriteSupported ? "webp" : "jpeg";
  const mimeType = cap.webpWriteSupported ? "image/webp" : "image/jpeg";
  const finalPath = join(absoluteOutputDir, `${itemId}.${outputExtension}`);
  const tmpPath = `${finalPath}.tmp-${randomUUID()}`;

  try {
    await mkdir(absoluteOutputDir, { recursive: true });
    await execFileAsync(
      "magick",
      [
        absoluteInputPath,
        "-auto-orient",
        "-resize",
        `${options.maxDimension}x${options.maxDimension}>`,
        "-quality",
        String(Math.round(options.quality * 100)),
        "-limit",
        "memory",
        "512MiB",
        "-limit",
        "map",
        "512MiB",
        "-limit",
        "area",
        "128MB",
        tmpPath,
      ],
      { timeout: CONVERT_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES, windowsHide: true },
    );
    await rename(tmpPath, finalPath);
    return { ok: true, outputPath: finalPath, outputFormat, mimeType, width: null, height: null, reason: null };
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    return { ok: false, outputPath: null, outputFormat: null, mimeType: null, width: null, height: null, reason: safeFailureReason(err) };
  }
}

export const imageMagickDecoder: HeicDecoder = {
  id: "imagemagick",
  checkCapability,
  decode,
};
