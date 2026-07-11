-- Phase 2 schema: Evidence Items, deterministic metadata, exact
-- duplicates, and scan run bookkeeping. See specs/03, specs/04,
-- specs/12, and docs/ARCHITECTURE_CONSTITUTION.md #7 (Scanner
-- responsibilities: discover, create items, extract metadata, persist —
-- nothing else).

CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  original_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  fs_created_at TEXT,
  fs_modified_at TEXT,
  missing_since TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  evidence_category TEXT NOT NULL DEFAULT 'unknown',
  UNIQUE (workspace_id, original_path)
);

CREATE INDEX IF NOT EXISTS idx_evidence_items_workspace
  ON evidence_items (workspace_id);

CREATE INDEX IF NOT EXISTS idx_evidence_items_sha256
  ON evidence_items (workspace_id, sha256);

-- Deterministic, type-specific metadata extracted by the Metadata
-- Engine. Kept separate from evidence_items so it can be recomputed and
-- overwritten freely (it is never user-supplied) without touching
-- review state. All columns are optional — extraction is best-effort
-- and never blocks scanning.
CREATE TABLE IF NOT EXISTS file_metadata (
  evidence_item_id TEXT PRIMARY KEY REFERENCES evidence_items(id),
  width INTEGER,
  height INTEGER,
  page_count INTEGER,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Exact-duplicate groups (SHA-256 match), rebuilt each scan run from the
-- current evidence_items state for the workspace. Near-duplicates are
-- out of scope (Phase 0 decision 6) — this table only ever reflects
-- byte-identical content.
CREATE TABLE IF NOT EXISTS duplicates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  sha256 TEXT NOT NULL,
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  UNIQUE (workspace_id, sha256, evidence_item_id)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  files_discovered INTEGER NOT NULL DEFAULT 0,
  items_created INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  items_unchanged INTEGER NOT NULL DEFAULT 0,
  items_content_changed INTEGER NOT NULL DEFAULT 0,
  items_missing INTEGER NOT NULL DEFAULT 0,
  duplicate_groups INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
