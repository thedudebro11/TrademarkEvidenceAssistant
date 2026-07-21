/**
 * Extension point for generated video thumbnails (Evidence Viewer
 * architecture). Every caller depends on this interface, never on a
 * concrete implementation, so a future ffmpeg-backed generator is a
 * drop-in swap — see the TODO below.
 *
 * Hard requirement for any future implementation: a generated thumbnail
 * is derived data, not evidence. It must be written only under
 * `generated/<workspace>/thumbnails/`, alongside the SQLite database
 * and other derived artifacts (docs/ARCHITECTURE_CONSTITUTION.md #6,
 * "generated data is separate from evidence" / "never store generated
 * data beside original evidence"). Never write into the evidence root,
 * and never modify the original video file.
 */
export interface ThumbnailProvider {
  /** Returns an absolute path to a generated thumbnail image for this video, or null if none exists / could be generated. */
  getThumbnailPath(absoluteVideoPath: string, itemId: string): Promise<string | null>;
}

/**
 * The provider in use today — always returns null (no thumbnail).
 * Generating one means decoding a frame from the video (ffmpeg), the
 * same dependency `videoMetadataProvider.ts` defers for now. Callers
 * (e.g. the Connections picker's thumbnail cards) already have a
 * documented fallback for "no image thumbnail available" — a file-type
 * badge — so returning null here degrades gracefully, not silently.
 */
export class DefaultThumbnailProvider implements ThumbnailProvider {
  async getThumbnailPath(_absoluteVideoPath: string, _itemId: string): Promise<string | null> {
    return null;
  }
}

/**
 * TODO(ffmpeg): implement `FfmpegThumbnailProvider implements
 * ThumbnailProvider`. Extract one frame at ~10-20% of the video's
 * duration (query duration via `videoMetadataProvider` once that's
 * ffmpeg-backed too, to avoid probing the file twice), write it as a
 * JPEG/PNG under `generated/<workspace>/thumbnails/<itemId>.jpg`
 * (create the directory if missing), and return that absolute path —
 * generate once and cache; check for the file's existence before
 * re-generating on subsequent calls. Then swap the export below to
 * `new FfmpegThumbnailProvider()`.
 */
export const thumbnailProvider: ThumbnailProvider = new DefaultThumbnailProvider();
