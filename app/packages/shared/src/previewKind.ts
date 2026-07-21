export type PreviewKind = "image" | "heic" | "pdf" | "video" | "text" | "unsupported";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg"]);
/**
 * HEIC/HEIF cannot be rendered inline by a plain `<img>` tag in any
 * mainstream browser today (docs/ADR_0005_HEIC_PREVIEWS.md) — kept as
 * its own PreviewKind, not folded into "image", so the web layer always
 * routes it to the dedicated HeicViewer (generated-preview + status UI)
 * rather than an `<img src>` that would simply fail to load.
 */
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
/**
 * Classified as "video" by extension alone — this is NOT a claim that
 * the browser can actually decode the codec inside. mkv/mov/m4v/avi
 * containers commonly hold codecs (e.g. HEVC, DivX) that many browsers
 * can't play, but the container itself is a legitimate video file and
 * must never be shown as "unsupported" for that reason alone (Evidence
 * Viewer architecture — see web/components/evidence-viewer/VideoViewer.tsx).
 * Actual playability is determined at runtime by the browser's own
 * <video> element error handling, with a graceful codec-unsupported
 * fallback (still fully "supported evidence," just not inline-playable).
 */
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mkv", "mov", "m4v", "avi"]);
const TEXT_EXTENSIONS = new Set(["txt", "csv", "json", "md"]);

/**
 * Classifies which preview strategy the Review Queue should use for a
 * file, by extension. Pure and shared so server (deciding what to
 * stream) and web (deciding how to render) never disagree — spec 11
 * requires an explicit "unsupported preview" state rather than a failed
 * render attempt for formats like PSD/XCF/AI that browsers cannot
 * display natively.
 */
export function getPreviewKind(extension: string): PreviewKind {
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (HEIC_EXTENSIONS.has(ext)) return "heic";
  if (ext === "pdf") return "pdf";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}
