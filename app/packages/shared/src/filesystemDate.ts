/**
 * Filesystem-last-modified date derivation for the Design Mockup Archive
 * Similar preset (docs/ADR_0004_ARCHIVE_SIMILAR.md's Design Mockup
 * extension). Shared so the server (preview + apply, both of which must
 * compute this from the database's current `fs_modified_at`) and the
 * web client (MetadataPanel's Details-panel readout) format the exact
 * same instant into the exact same calendar day, every time.
 *
 * `EvidenceItem.filesystemModifiedAt` / `EvidenceItemDetail.fsModifiedAt`
 * is stored as `stats.mtime.toISOString()` (scannerEngine.ts) — a UTC
 * instant. Formatting it with the environment's *local* getters
 * (getMonth/getDate/getFullYear), not the UTC ones, is what recovers the
 * original local calendar day the file was actually modified on: this
 * app's server and browser both run on the same machine, so "local" is
 * the same clock on both sides, and using UTC getters here would risk
 * silently shifting the displayed day near midnight.
 */

export type FilesystemDateReasonCode = "MISSING_FILESYSTEM_DATE" | "INVALID_FILESYSTEM_DATE";

export const FILESYSTEM_DATE_CAVEAT_NOTE =
  "Auto-filled from this file's filesystem last-modified date. This date may not represent the original design creation date.";

/**
 * `M/D/YYYY`, no zero-padding — matches the shape `toLocaleDateString()`
 * already produced for en-US users (MetadataPanel.tsx's prior
 * behavior), but deterministic regardless of the running environment's
 * ICU/locale configuration, so server-derived and client-rendered dates
 * can never disagree over a locale difference.
 */
export function formatFilesystemDate(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export interface DerivedDateAnswer {
  available: boolean;
  rawTimestamp: string | null;
  /** The exact string that would be saved as the answer's `value` — identical to `displayValue` today, kept as a separate field in case a future answer format diverges from the display string. */
  answerValue: string | null;
  displayValue: string | null;
  source: "filesystem_last_modified";
  confidence: "medium";
  note: string | null;
  reasonCode: FilesystemDateReasonCode | null;
}

function unavailable(rawTimestamp: string | null, reasonCode: FilesystemDateReasonCode): DerivedDateAnswer {
  return { available: false, rawTimestamp, answerValue: null, displayValue: null, source: "filesystem_last_modified", confidence: "medium", note: null, reasonCode };
}

/**
 * Derives the "Roughly when was this created?" answer for one Design
 * Mockup from its own `filesystem_modified_at` — never the source
 * item's date, never upload/review/database-update time, never a
 * filename guess. Returns `available: false` (never an invented date)
 * when the timestamp is missing or unparseable; the caller is
 * responsible for excluding the item from the bulk operation in that
 * case rather than silently falling back to anything else.
 */
export function deriveDesignMockupDateAnswer(filesystemModifiedAt: string | null): DerivedDateAnswer {
  if (!filesystemModifiedAt) {
    return unavailable(null, "MISSING_FILESYSTEM_DATE");
  }
  const parsed = new Date(filesystemModifiedAt);
  if (Number.isNaN(parsed.getTime())) {
    return unavailable(filesystemModifiedAt, "INVALID_FILESYSTEM_DATE");
  }
  const display = formatFilesystemDate(filesystemModifiedAt);
  return {
    available: true,
    rawTimestamp: filesystemModifiedAt,
    answerValue: display,
    displayValue: display,
    source: "filesystem_last_modified",
    confidence: "medium",
    note: FILESYSTEM_DATE_CAVEAT_NOTE,
    reasonCode: null,
  };
}
