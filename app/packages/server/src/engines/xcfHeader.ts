import { openSync, readSync, closeSync } from "node:fs";

const SIGNATURE_PREFIX = "gimp xcf ";
const HEADER_LENGTH = 22; // 14-byte magic + width(4) + height(4)

export interface XcfDimensions {
  width: number;
  height: number;
}

/**
 * Reads the fixed GIMP XCF file header: a 14-byte magic
 * ("gimp xcf " + 5-byte version tag), followed immediately by width
 * (uint32 BE) and height (uint32 BE). Returns null on any signature
 * mismatch or implausible value — extraction failure is never fatal to
 * a scan (docs/ARCHITECTURE_CONSTITUTION.md #9).
 */
export function readXcfDimensions(absolutePath: string): XcfDimensions | null {
  const fd = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_LENGTH);
    const bytesRead = readSync(fd, buffer, 0, HEADER_LENGTH, 0);
    if (bytesRead < HEADER_LENGTH) {
      return null;
    }
    if (buffer.toString("ascii", 0, 9) !== SIGNATURE_PREFIX) {
      return null;
    }
    const width = buffer.readUInt32BE(14);
    const height = buffer.readUInt32BE(18);
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } finally {
    closeSync(fd);
  }
}
