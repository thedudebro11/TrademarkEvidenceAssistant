/**
 * Decoder-provider abstraction for HEIC/HEIF preview generation
 * (docs/ADR_0005_HEIC_PREVIEWS.md, decoder-independence addendum). This
 * exists because a single hard-coded ImageMagick pipeline was found to
 * silently produce visually corrupted (tiled/fragmented) output for a
 * real-world Android-camera HEIC file, even though the conversion
 * process exited successfully and wrote structurally valid image bytes
 * — proof that "the process succeeded" and "the pixels are correct" are
 * different claims, and only the second one matters here. Every decoder
 * implements the same narrow contract so `heicPreviewService.ts` never
 * hard-codes which one it's calling, and a decoder proven bad for a
 * given HEIC family can be excluded from automatic use without deleting
 * its code.
 */

export interface HeicDecoderCapability {
  available: boolean;
  /** Human-readable decoder version, stored on the preview row and included in its cache identity. */
  version: string | null;
  /** A short, safe-to-display reason capability is false — never a raw stack trace. `null` when available. */
  failureReason: string | null;
}

export interface HeicDecodeOptions {
  /** Longest edge, in pixels, the output is resized to (preserving aspect ratio). Never upscales. */
  maxDimension: number;
  /** 0-1 encoder quality. */
  quality: number;
}

export interface HeicDecodeResult {
  ok: boolean;
  /** Absolute path of the written output file, already renamed into its final location. `null` when `ok` is false. */
  outputPath: string | null;
  outputFormat: "jpeg" | "webp" | null;
  mimeType: string | null;
  /** Decoded pixel dimensions, when the decoder can report them — used only for a structural sanity check, never as proof of visual correctness. */
  width: number | null;
  height: number | null;
  /** A short, safe-to-display failure reason — never a raw stack trace, command line, or server filesystem path. */
  reason: string | null;
}

/**
 * One HEIC/HEIF decoding backend. `id` is persisted verbatim on
 * `heic_previews.preview_generator` and is part of that row's cache
 * identity — changing what `id` a decoder implementation reports is
 * effectively a breaking schema change, since it silently stops
 * matching previously-stored rows.
 */
export interface HeicDecoder {
  id: string;
  /**
   * Never assumed — probed fresh (subject to the decoder's own
   * memoization) before every automatic generation attempt, mirroring
   * the "presence proves nothing, only a real probe does" rule
   * `imageMagickCapability.ts` established.
   */
  checkCapability(): Promise<HeicDecoderCapability>;
  /**
   * Decodes `absoluteInputPath` and writes a browser-viewable image
   * into `absoluteOutputDir`, named `<itemId>.<extension>`. Must write
   * to a randomized temp path first and rename into place only on
   * success, so a crashed/killed decode never leaves a partial file at
   * the real output path — every implementation is responsible for its
   * own atomicity, `heicPreviewService.ts` does not add a second layer
   * of it.
   */
  decode(absoluteInputPath: string, absoluteOutputDir: string, itemId: string, options: HeicDecodeOptions): Promise<HeicDecodeResult>;
}
