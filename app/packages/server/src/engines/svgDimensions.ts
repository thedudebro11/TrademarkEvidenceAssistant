import { openSync, readSync, closeSync } from "node:fs";

const HEAD_BYTES_TO_READ = 8192;

export interface SvgDimensions {
  width: number;
  height: number;
}

/**
 * Reads only the first 8KB of an SVG file (the root `<svg>` tag is
 * always near the top) and extracts width/height from explicit
 * `width`/`height` attributes, falling back to `viewBox`. Deliberately
 * avoids reading whole files into memory — this project's real evidence
 * includes an 8MB SVG. Returns null if no usable dimensions are found;
 * extraction failure is never fatal to a scan.
 */
export function readSvgDimensions(absolutePath: string): SvgDimensions | null {
  const fd = openSync(absolutePath, "r");
  let head: string;
  try {
    const buffer = Buffer.alloc(HEAD_BYTES_TO_READ);
    const bytesRead = readSync(fd, buffer, 0, HEAD_BYTES_TO_READ, 0);
    head = buffer.toString("utf-8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }

  const svgTagMatch = head.match(/<svg\b[^>]*>/i);
  if (!svgTagMatch) {
    return null;
  }
  const svgTag = svgTagMatch[0];

  const width = extractPixelAttribute(svgTag, "width");
  const height = extractPixelAttribute(svgTag, "height");
  if (width !== null && height !== null) {
    return { width, height };
  }

  const viewBoxMatch = svgTag.match(/viewBox\s*=\s*["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBoxMatch) {
    const vbWidth = Number(viewBoxMatch[1]);
    const vbHeight = Number(viewBoxMatch[2]);
    if (Number.isFinite(vbWidth) && Number.isFinite(vbHeight) && vbWidth > 0 && vbHeight > 0) {
      return { width: Math.round(vbWidth), height: Math.round(vbHeight) };
    }
  }

  return null;
}

function extractPixelAttribute(svgTag: string, name: "width" | "height"): number | null {
  const match = svgTag.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, "i"));
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
