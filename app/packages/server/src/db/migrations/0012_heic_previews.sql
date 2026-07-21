-- HEIC/HEIF inline preview generation.
--
-- The original HEIC/HEIF file is never modified, renamed, or moved —
-- this table only ever describes a *derived* browser-viewable image
-- generated from it, stored under generated/<workspace>/heic-previews/
-- (a directory scannerEngine.ts already refuses to descend into, so a
-- normal rescan can never import a generated preview as a second
-- evidence item). One row per evidence item, created lazily the first
-- time a preview is requested or backfilled.
--
-- source_fingerprint mirrors evidence_items.sha256 at the time this
-- preview was generated — evidence_items already computes a full
-- content hash for every file on every scan, so reusing it here (rather
-- than hashing the file a second time) is what "cache invalidation
-- keyed on the original file's content" means in practice: a mismatch
-- against the item's *current* sha256 means the source file changed
-- since this preview was made, and the preview is stale.
CREATE TABLE IF NOT EXISTS heic_previews (
  evidence_item_id TEXT PRIMARY KEY REFERENCES evidence_items(id),
  preview_relative_path TEXT,
  preview_mime_type TEXT,
  preview_status TEXT NOT NULL DEFAULT 'not_requested',
  preview_generated_at TEXT,
  preview_generator TEXT,
  preview_generator_version TEXT,
  source_fingerprint TEXT,
  conversion_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- HEIC/HEIF-specific metadata, extracted directly from the original
-- file (never from the generated preview — see docs on
-- heicExifEngine.ts). Kept alongside file_metadata's existing
-- width/height/page_count rather than in a new table, since it's the
-- same kind of thing: deterministic, extractor-computed, freely
-- recomputable, never user-supplied. Every column is nullable and
-- populated only for heic/heif items — every other extension's row
-- simply leaves these null, exactly like page_count already does for
-- non-PDF files.
ALTER TABLE file_metadata ADD COLUMN exif_date_time_original TEXT;
ALTER TABLE file_metadata ADD COLUMN exif_create_date TEXT;
ALTER TABLE file_metadata ADD COLUMN gps_latitude REAL;
ALTER TABLE file_metadata ADD COLUMN gps_longitude REAL;
ALTER TABLE file_metadata ADD COLUMN camera_make TEXT;
ALTER TABLE file_metadata ADD COLUMN camera_model TEXT;
ALTER TABLE file_metadata ADD COLUMN orientation INTEGER;
ALTER TABLE file_metadata ADD COLUMN color_profile TEXT;
ALTER TABLE file_metadata ADD COLUMN filename_inferred_date TEXT;

-- One row per "Generate Missing Previews" backfill run — job-level
-- progress only; per-file results live in heic_previews itself (each
-- file's own preview_status/conversion_error IS its persisted per-file
-- outcome, so this table isn't a duplicate of that).
CREATE TABLE IF NOT EXISTS heic_backfill_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_heic_backfill_jobs_workspace ON heic_backfill_jobs (workspace_id);
