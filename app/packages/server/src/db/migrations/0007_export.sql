-- Phase 7 schema (spec 12 table names): tracks each export run and
-- exactly which items it copied, so exports are auditable without
-- re-deriving anything from the filesystem.
CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  export_path TEXT NOT NULL,
  items_exported INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS export_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  export_id INTEGER NOT NULL REFERENCES exports(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  export_relative_path TEXT NOT NULL,
  sha256_verified INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_export_items_export ON export_items (export_id);
