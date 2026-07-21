import type { VideoMetadata } from "@trademark-evidence-assistant/shared";

/**
 * Extension point for video metadata extraction (Evidence Viewer
 * architecture). Every caller depends on this interface, never on a
 * concrete implementation — so a future ffmpeg-backed provider is a
 * drop-in swap, not a refactor. See the TODO below the default
 * implementation for exactly what to change when that happens.
 */
export interface VideoMetadataProvider {
  getVideoMetadata(absolutePath: string): Promise<VideoMetadata>;
}

const UNKNOWN_VIDEO_METADATA: VideoMetadata = {
  durationSeconds: null,
  width: null,
  height: null,
  codec: null,
  fps: null,
  bitrateKbps: null,
  hasAudio: null,
};

/**
 * The provider in use today. Deliberately returns "unknown" for every
 * field — extracting real duration/codec/fps/bitrate/audio-presence
 * requires decoding the video (ffmpeg/ffprobe), which this project
 * doesn't depend on yet (a real, large, platform-native-binary
 * dependency, judged out of scope for this pass — see the ADR/session
 * notes on the OCR feature for why WASM-based tools were preferred
 * where possible, and why this one doesn't have an easy WASM
 * equivalent). Returning nulls is the honest answer, not a stub bug:
 * docs/DESIGN_LANGUAGE.md — "never pretend to know more than it does."
 *
 * This never reads the file at all (the path argument is unused) — it's
 * the correct behavior for "we can't determine this without a decoder,"
 * not a placeholder that happens to skip work.
 */
export class DefaultVideoMetadataProvider implements VideoMetadataProvider {
  async getVideoMetadata(_absolutePath: string): Promise<VideoMetadata> {
    return UNKNOWN_VIDEO_METADATA;
  }
}

/**
 * TODO(ffmpeg): implement `FfmpegVideoMetadataProvider implements
 * VideoMetadataProvider`, using ffprobe (e.g. via `fluent-ffmpeg` +
 * `ffmpeg-static`, or a standalone ffprobe wrapper) to populate real
 * values from `absolutePath`. Then swap the export below to
 * `new FfmpegVideoMetadataProvider()` — the route
 * (`GET /api/evidence-items/:id/video-metadata`), the shared
 * `VideoMetadata` type, and the web Details panel all already consume
 * this interface's shape and require zero changes.
 */
export const videoMetadataProvider: VideoMetadataProvider = new DefaultVideoMetadataProvider();
