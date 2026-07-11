-- Phase 4 schema: manual file-role assignment (spec 03) and guided
-- question answers (spec 06).
ALTER TABLE evidence_items ADD COLUMN file_role TEXT;

-- One row per (item, question) pair; a question set is entirely
-- determined by the item's current file_role (spec 06) plus the
-- always-asked universal questions. Answers are never deleted when the
-- role changes and a different question set becomes visible — only the
-- display changes, per docs/ARCHITECTURE_CONSTITUTION.md #9
-- (deterministic, explainable: nothing the user typed silently vanishes).
CREATE TABLE IF NOT EXISTS review_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  question_id TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user',
  confidence TEXT,
  note TEXT,
  answered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (evidence_item_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_review_answers_item
  ON review_answers (evidence_item_id);
