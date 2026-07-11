export type PreviewKind = "image" | "pdf" | "video" | "text" | "unsupported";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm"]); // mkv/mov/avi are not reliably browser-playable
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
  if (ext === "pdf") return "pdf";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}
