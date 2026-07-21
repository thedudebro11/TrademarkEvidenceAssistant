import { extname } from "node:path";
import type Database from "better-sqlite3";
import { createWorker } from "tesseract.js";
import { getPreviewKind, type OcrExtraction } from "@trademark-evidence-assistant/shared";
import { extractCandidates } from "../engines/ocrEngine.js";
import { resolveItemFile } from "./reviewService.js";

export class OcrError extends Error {}

/**
 * On-demand text extraction from an evidence image, for pre-filling
 * interview fields (order numbers, dates) that the user would otherwise
 * have to read off the image and type by hand. Deliberately triggered
 * per item, never automatic or batched — OCR is slow (real CPU work)
 * and this project's "never auto-confirm a suggestion" rule means the
 * result is always shown for the user to accept, never written anywhere
 * on its own. Only image files are supported; PDFs would need a
 * PDF-to-image conversion step this doesn't attempt.
 *
 * Uses the same `resolveItemFile`/`resolveSafePath` path-safety guard as
 * every other read of an evidence file — this only ever reads bytes,
 * never writes, moves, or renames the original.
 */
export async function extractTextFromItem(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  evidenceRoot: string,
): Promise<OcrExtraction> {
  const resolved = resolveItemFile(db, workspaceId, itemId, evidenceRoot);
  if (resolved.kind === "not_found") {
    throw new OcrError("Evidence item not found");
  }
  if (resolved.kind === "missing") {
    throw new OcrError("The original file for this evidence item can no longer be found on disk");
  }

  const extension = extname(resolved.absolutePath).replace(/^\./, "");
  if (getPreviewKind(extension) !== "image") {
    throw new OcrError(`Text extraction only supports image files — ".${extension}" is not one`);
  }

  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(resolved.absolutePath);
    return extractCandidates(data.text);
  } finally {
    await worker.terminate();
  }
}
