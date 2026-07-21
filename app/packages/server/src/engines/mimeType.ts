/**
 * Deterministic extension -> MIME type lookup. Extension-based (not
 * content-sniffing) by design: simple, fully deterministic, and
 * sufficient for spec 01's supported file groups.
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  psd: "image/vnd.adobe.photoshop",
  xcf: "image/x-xcf",
  ai: "application/postscript",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  txt: "text/plain",
  rtf: "application/rtf",
  json: "application/json",
  csv: "text/csv",
  md: "text/markdown",
};

export function mimeTypeForExtension(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  return EXTENSION_TO_MIME[normalized] ?? "application/octet-stream";
}
