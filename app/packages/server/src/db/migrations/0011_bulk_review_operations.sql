-- "Archive Similar" bulk review audit + undo history.
--
-- One row in bulk_review_operations per bulk operation run (e.g. one
-- "Archive Similar" click); one row in bulk_review_operation_items per
-- evidence item the operation touched (applied, skipped, or failed).
-- Stores only the review-relevant fields needed to explain and safely
-- reverse the operation — never file-specific data (filenames, OCR
-- text, connections, etc. are never copied by this feature and so are
-- never snapshotted here either).
--
-- item_version_before/item_version_after are content fingerprints (a
-- hash of the review-relevant fields at that moment — see
-- bulkReviewService.ts's computeItemFingerprint), not a schema version
-- column on evidence_items. This avoids widening evidence_items itself
-- just for this feature, while still letting Undo detect "did a human
-- edit this item after the bulk operation ran" before restoring it.
CREATE TABLE IF NOT EXISTS bulk_review_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  operation_type TEXT NOT NULL,
  source_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  folder_path TEXT NOT NULL,
  evidence_type_id TEXT NOT NULL,
  review_template_json TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  initiated_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  undone_at TEXT,
  undo_status TEXT,
  requested_count INTEGER NOT NULL DEFAULT 0,
  applied_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  restored_count INTEGER NOT NULL DEFAULT 0,
  restore_skipped_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bulk_review_operations_workspace ON bulk_review_operations (workspace_id);

CREATE TABLE IF NOT EXISTS bulk_review_operation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES bulk_review_operations(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  is_source_item INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  skip_reason_code TEXT,
  before_state_json TEXT,
  after_state_json TEXT,
  item_version_before TEXT,
  item_version_after TEXT,
  applied_at TEXT,
  restored_at TEXT,
  restore_result TEXT,
  restore_skip_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_bulk_review_operation_items_operation ON bulk_review_operation_items (operation_id);
CREATE INDEX IF NOT EXISTS idx_bulk_review_operation_items_evidence_item ON bulk_review_operation_items (evidence_item_id);
