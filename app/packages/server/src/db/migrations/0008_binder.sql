-- Phase 8 schema (spec 12 table name): tracks each binder generation
-- and which export it was built from.
CREATE TABLE IF NOT EXISTS binder_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  export_id INTEGER NOT NULL REFERENCES exports(id),
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  output_path TEXT NOT NULL
);
