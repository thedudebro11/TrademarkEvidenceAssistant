import { imageSize } from "image-size";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readPsdDimensions } from "./psdHeader.js";
import { readXcfDimensions } from "./xcfHeader.js";
import { readSvgDimensions } from "./svgDimensions.js";
import { extractHeicExifMetadata } from "./heicExifEngine.js";
import { inferDateFromFilename } from "./filenameDateInference.js";

// Kept as its own local set (not imported from services/heicPreviewService.ts)
// so this engines/ module never depends on the services/ layer above it.
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

export interface ExtractedMetadata {
  width: number | null;
  height: number | null;
  pageCount: number | null;
  /** HEIC/HEIF-only — always undefined for every other extension. See docs/ADR_0005_HEIC_PREVIEWS.md; the original file is always the source for these, never the generated preview. */
  exifDateTimeOriginal?: string | null;
  exifCreateDate?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  orientation?: number | null;
  colorProfile?: string | null;
  filenameInferredDate?: string | null;
}

const EMPTY: ExtractedMetadata = { width: null, height: null, pageCount: null };

const RASTER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

/**
 * Extracts deterministic, type-specific metadata for one file, per
 * extension. Every branch is best-effort and fails soft (returns nulls
 * for what it couldn't determine) rather than throwing — a metadata
 * extraction failure must never abort a scan
 * (docs/ARCHITECTURE_CONSTITUTION.md #7 and #9). Video technical
 * metadata (duration/resolution) is intentionally out of scope for v1 —
 * see docs/IMPROVEMENT_PROPOSALS.md.
 */
export async function extractMetadata(
  absolutePath: string,
  extension: string,
  filename: string = basename(absolutePath),
): Promise<ExtractedMetadata> {
  const ext = extension.toLowerCase().replace(/^\./, "");

  try {
    if (RASTER_EXTENSIONS.has(ext)) {
      const dims = imageSize(absolutePath);
      return { width: dims.width ?? null, height: dims.height ?? null, pageCount: null };
    }

    if (HEIC_EXTENSIONS.has(ext)) {
      // Always from the original HEIC/HEIF file — never from the
      // generated preview, which is produced by an entirely separate
      // operation (heicPreviewService.ts) and never treated as a
      // metadata source (docs/ADR_0005_HEIC_PREVIEWS.md). Filename
      // inference is a weak, clearly-separate assertion — never
      // combined with or preferred over the EXIF fields above it.
      const exif = await extractHeicExifMetadata(absolutePath);
      return {
        width: exif.width,
        height: exif.height,
        pageCount: null,
        exifDateTimeOriginal: exif.exifDateTimeOriginal,
        exifCreateDate: exif.exifCreateDate,
        gpsLatitude: exif.gpsLatitude,
        gpsLongitude: exif.gpsLongitude,
        cameraMake: exif.cameraMake,
        cameraModel: exif.cameraModel,
        orientation: exif.orientation,
        colorProfile: exif.colorProfile,
        filenameInferredDate: inferDateFromFilename(filename),
      };
    }

    if (ext === "svg") {
      const dims = readSvgDimensions(absolutePath);
      return dims
        ? { width: dims.width, height: dims.height, pageCount: null }
        : EMPTY;
    }

    if (ext === "psd") {
      const dims = readPsdDimensions(absolutePath);
      return dims
        ? { width: dims.width, height: dims.height, pageCount: null }
        : EMPTY;
    }

    if (ext === "xcf") {
      const dims = readXcfDimensions(absolutePath);
      return dims
        ? { width: dims.width, height: dims.height, pageCount: null }
        : EMPTY;
    }

    if (ext === "pdf") {
      const bytes = await readFile(absolutePath);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      return { width: null, height: null, pageCount: doc.getPageCount() };
    }

    return EMPTY;
  } catch {
    // Corrupt or unreadable file for this extractor — a scan must still
    // succeed with metadata simply absent (explainable, not silent
    // failure elsewhere in the app: the item still exists, just with
    // null fields).
    return EMPTY;
  }
}
