-- Preserve bulk-operation audit/Undo history for evidence items that
-- survive a "Remove Missing Records" cleanup, even when the *removed*
-- item was itself a bulk operation's source (missingRecordsService.ts).
--
-- Before this migration, bulk_review_operations.source_item_id was
-- `TEXT NOT NULL REFERENCES evidence_items(id)` with no ON DELETE
-- clause (SQLite's implicit default is NO ACTION) — under this
-- database's own `PRAGMA foreign_keys = ON`, deleting the evidence_items
-- row a bulk operation was sourced from would either be blocked outright,
-- or (as missingRecordsService.ts's first version did, to work around
-- that) required deleting the ENTIRE bulk_review_operations row plus
-- every one of its bulk_review_operation_items rows — destroying audit
-- and Undo history for every OTHER, still-existing evidence item that
-- operation touched, merely because the source happened to also be
-- missing. That is never acceptable: removing one missing record must
-- never erase history for unrelated surviving records.
--
-- Fix: source_item_id becomes nullable with ON DELETE SET NULL, and two
-- new columns (source_item_filename, source_item_original_path) snapshot
-- the source's identity at apply time, so the operation stays
-- understandable in the UI/audit trail even after source_item_id goes
-- NULL. Every other column is unchanged, and bulk_review_operation_items
-- is untouched by this migration — a removed item's own single row
-- there is deleted individually (missingRecordsService.ts), which was
-- already safe and never needed a schema change: deleting the
-- *referencing* row never violates a foreign key, only deleting the
-- *referenced* row while a reference still points at it does. Only the
-- source_item_id path had that problem, because a *table-level* FK (one
-- row per operation, not per touched item) was being treated as if
-- deleting the source meant deleting the whole operation.
--
-- SQLite has no ALTER COLUMN for changing a FK's ON DELETE behavior, so
-- this is the standard 12-step table-rebuild procedure (see the SQLite
-- documentation, "Making Other Kinds Of Table Schema Changes").
-- migrate.ts runs this one migration's DDL with foreign key enforcement
-- temporarily disabled (see FOREIGN_KEY_REBUILD_MIGRATIONS there) —
-- PRAGMA foreign_keys is a no-op inside an active transaction, and this
-- rebuild would otherwise be blocked by bulk_review_operation_items'
-- own foreign key into this table while it's being dropped and recreated.

CREATE TABLE bulk_review_operations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  operation_type TEXT NOT NULL,
  source_item_id TEXT REFERENCES evidence_items(id) ON DELETE SET NULL,
  source_item_filename TEXT,
  source_item_original_path TEXT,
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

-- Backfills the two new snapshot columns for every existing row from
-- the source's *current* evidence_items data — the best available
-- information at migration time. A source already missing/removed
-- before this migration ran leaves them NULL (LEFT JOIN), same as any
-- future row will have once its own source is removed going forward.
INSERT INTO bulk_review_operations_new
  (id, workspace_id, operation_type, source_item_id, source_item_filename, source_item_original_path,
   folder_path, evidence_type_id, review_template_json, status, idempotency_key, initiated_by, created_at,
   completed_at, undone_at, undo_status, requested_count, applied_count, skipped_count, failed_count,
   restored_count, restore_skipped_count, error_summary)
SELECT
  o.id, o.workspace_id, o.operation_type, o.source_item_id,
  ei.original_filename, ei.original_path,
  o.folder_path, o.evidence_type_id, o.review_template_json, o.status, o.idempotency_key, o.initiated_by, o.created_at,
  o.completed_at, o.undone_at, o.undo_status, o.requested_count, o.applied_count, o.skipped_count, o.failed_count,
  o.restored_count, o.restore_skipped_count, o.error_summary
FROM bulk_review_operations o
LEFT JOIN evidence_items ei ON ei.id = o.source_item_id;

DROP TABLE bulk_review_operations;
ALTER TABLE bulk_review_operations_new RENAME TO bulk_review_operations;

CREATE INDEX IF NOT EXISTS idx_bulk_review_operations_workspace ON bulk_review_operations (workspace_id);
