/**
 * Weak, best-effort date inference from common camera-app filename
 * conventions (e.g. Android/Google Camera's `IMG_20260717_020251.heic`).
 * Never authoritative — docs/ADR_0005_HEIC_PREVIEWS.md's date-preference
 * order ranks this below EXIF DateTimeOriginal/CreateDate and above
 * only the filesystem timestamp, and every caller must keep this
 * clearly labeled as filename-derived rather than presenting it as a
 * confirmed capture date. Returns a local-time ISO-8601-shaped string
 * (no timezone offset asserted — a filename carries no timezone
 * information at all) or `null` when no recognized pattern matches.
 */
export function inferDateFromFilename(filename: string): string | null {
  const match = filename.match(/(?:IMG|PXL|VID)[_-](\d{4})(\d{2})(\d{2})[_-]?(\d{2})?(\d{2})?(\d{2})?/i);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const hour = hourStr ? Number(hourStr) : 0;
  const minute = minuteStr ? Number(minuteStr) : 0;
  const second = secondStr ? Number(secondStr) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}
