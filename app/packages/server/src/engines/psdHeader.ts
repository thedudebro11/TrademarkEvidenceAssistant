import { openSync, readSync, closeSync } from "node:fs";

const SIGNATURE = "8BPS";
const HEADER_LENGTH = 26;

export interface PsdDimensions {
  width: number;
  height: number;
}

/**
 * Reads only the fixed 26-byte PSD file header (signature, version,
 * reserved, channels, height, width, depth, color mode) to extract
 * width/height, per the documented Adobe PSD file format spec. Returns
 * null if the file does not have a valid PSD signature — extraction
 * failure is never fatal to a scan (docs/ARCHITECTURE_CONSTITUTION.md
 * #9: results are explainable, not "magic," and absence of metadata is
 * a valid, honest outcome).
 */
export function readPsdDimensions(absolutePath: string): PsdDimensions | null {
  const fd = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_LENGTH);
    const bytesRead = readSync(fd, buffer, 0, HEADER_LENGTH, 0);
    if (bytesRead < HEADER_LENGTH) {
      return null;
    }
    if (buffer.toString("ascii", 0, 4) !== SIGNATURE) {
      return null;
    }
    const height = buffer.readUInt32BE(14);
    const width = buffer.readUInt32BE(18);
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } finally {
    closeSync(fd);
  }
}
