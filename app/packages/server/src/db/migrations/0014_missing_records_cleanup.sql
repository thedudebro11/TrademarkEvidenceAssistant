-- "Remove Missing Records" cleanup audit + undo snapshot, modeled on
-- migration 0011's bulk_review_operations/bulk_review_operation_items
-- (one envelope row per run, one item row per evidence item touched).
--
-- The key difference from that precedent: Archive Similar never deletes
-- an evidence_items row, so its undo can re-read "before" state from
-- the row itself. This feature permanently deletes the evidence_items
-- row, so `missing_records_cleanup_items.evidence_item_id` is
-- deliberately NOT a foreign key to evidence_items(id) — the whole
-- point is that row may no longer exist. `snapshot_json` instead holds
-- everything (the full evidence_items row plus its dependent rows)
-- needed to fully reconstruct the record for Undo, and
-- original_filename/original_path/evidence_type_id/prior_review_status/
-- prior_inclusion_decision are duplicated as their own columns so the
-- audit trail stays human-readable without parsing JSON, per "store the
-- necessary identifying snapshot directly in the cleanup audit record."
CREATE TABLE IF NOT EXISTS missing_records_cleanup_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'in_progress',
  idempotency_key TEXT,
  initiated_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  requested_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  backup_exported INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  undone_at TEXT,
  undo_status TEXT,
  restored_count INTEGER NOT NULL DEFAULT 0,
  restore_skipped_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_missing_records_cleanup_operations_workspace
  ON missing_records_cleanup_operations (workspace_id);

CREATE TABLE IF NOT EXISTS missing_records_cleanup_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES missing_records_cleanup_operations(id),
  evidence_item_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  original_path TEXT NOT NULL,
  evidence_type_id TEXT,
  prior_review_status TEXT,
  prior_inclusion_decision TEXT,
  dependency_counts_json TEXT,
  result TEXT NOT NULL,
  skip_reason_code TEXT,
  snapshot_json TEXT,
  removed_at TEXT,
  restored_at TEXT,
  restore_result TEXT,
  restore_skip_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_missing_records_cleanup_items_operation
  ON missing_records_cleanup_items (operation_id);
CREATE INDEX IF NOT EXISTS idx_missing_records_cleanup_items_evidence_item
  ON missing_records_cleanup_items (evidence_item_id);
