import { imageSize } from "image-size";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { readPsdDimensions } from "./psdHeader.js";
import { readXcfDimensions } from "./xcfHeader.js";
import { readSvgDimensions } from "./svgDimensions.js";

export interface ExtractedMetadata {
  width: number | null;
  height: number | null;
  pageCount: number | null;
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
): Promise<ExtractedMetadata> {
  const ext = extension.toLowerCase().replace(/^\./, "");

  try {
    if (RASTER_EXTENSIONS.has(ext)) {
      const dims = imageSize(absolutePath);
      return { width: dims.width ?? null, height: dims.height ?? null, pageCount: null };
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
