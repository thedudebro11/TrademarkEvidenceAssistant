import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HeicExifMetadata {
  width: number | null;
  height: number | null;
  exifDateTimeOriginal: string | null;
  exifCreateDate: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  orientation: number | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  colorProfile: string | null;
}

const EXTRACT_TIMEOUT_MS = 15_000;
const MAX_BUFFER_BYTES = 1024 * 1024;

// Unit separator (0x1F) — never appears in real EXIF text, unlike a
// visible delimiter such as "|" which could plausibly appear inside a
// GPS or description field.
const FIELD_SEPARATOR = "\x1f";
const FORMAT_STRING = [
  "%w",
  "%h",
  "%[EXIF:DateTimeOriginal]",
  "%[EXIF:DateTime]",
  "%[EXIF:Make]",
  "%[EXIF:Model]",
  "%[EXIF:Orientation]",
  "%[EXIF:GPSLatitude]",
  "%[EXIF:GPSLatitudeRef]",
  "%[EXIF:GPSLongitude]",
  "%[EXIF:GPSLongitudeRef]",
  "%[icc:description]",
].join(FIELD_SEPARATOR);

const EMPTY: HeicExifMetadata = {
  width: null,
  height: null,
  exifDateTimeOriginal: null,
  exifCreateDate: null,
  cameraMake: null,
  cameraModel: null,
  orientation: null,
  gpsLatitude: null,
  gpsLongitude: null,
  colorProfile: null,
};

function nullIfBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parses one EXIF GPS component (e.g. `"37/1, 46/1, 3000/100"` — a
 * degrees/minutes/seconds rational triplet) plus its N/S or E/W
 * reference into signed decimal degrees. Returns `null` for anything
 * that doesn't parse as exactly three valid rationals, rather than a
 * best-effort partial value.
 */
function parseGpsCoordinate(raw: string | null, ref: string | null): number | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== 3) return null;
  const toDecimal = (rational: string): number | null => {
    const [num, den] = rational.split("/").map(Number);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
  };
  const [d, m, s] = parts.map(toDecimal);
  if (d === null || m === null || s === null) return null;
  const decimal = d + m / 60 + s / 3600;
  const negative = ref?.trim().toUpperCase() === "S" || ref?.trim().toUpperCase() === "W";
  return negative ? -decimal : decimal;
}

/**
 * Extracts dimensions and EXIF/GPS/color-profile metadata directly
 * from the original HEIC/HEIF file via `magick identify` — never from
 * the generated preview (docs/ADR_0005_HEIC_PREVIEWS.md: "the original
 * remains the authoritative metadata source", and preview conversion
 * is a wholly separate operation from this one). `absolutePath` is
 * passed as its own argv element (execFile, no shell), so a hostile
 * filename can never inject additional command-line arguments.
 *
 * Fails soft: any error (corrupt file, ImageMagick crash, HEIC support
 * unavailable) returns every field `null` rather than throwing,
 * matching metadataEngine.ts's existing "a metadata extraction failure
 * must never abort a scan" convention.
 */
export async function extractHeicExifMetadata(absolutePath: string): Promise<HeicExifMetadata> {
  try {
    const { stdout } = await execFileAsync("magick", ["identify", "-format", FORMAT_STRING, absolutePath], {
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    const fields = stdout.split(FIELD_SEPARATOR);
    const [widthRaw, heightRaw, dateTimeOriginal, dateTime, make, model, orientationRaw, gpsLatRaw, gpsLatRef, gpsLonRaw, gpsLonRef, iccDescription] = fields;

    const width = Number.parseInt(widthRaw ?? "", 10);
    const height = Number.parseInt(heightRaw ?? "", 10);
    const orientation = Number.parseInt(orientationRaw ?? "", 10);

    return {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      exifDateTimeOriginal: nullIfBlank(dateTimeOriginal),
      exifCreateDate: nullIfBlank(dateTime),
      cameraMake: nullIfBlank(make),
      cameraModel: nullIfBlank(model),
      orientation: Number.isFinite(orientation) ? orientation : null,
      gpsLatitude: parseGpsCoordinate(nullIfBlank(gpsLatRaw), nullIfBlank(gpsLatRef)),
      gpsLongitude: parseGpsCoordinate(nullIfBlank(gpsLonRaw), nullIfBlank(gpsLonRef)),
      colorProfile: nullIfBlank(iccDescription),
    };
  } catch {
    return EMPTY;
  }
}
