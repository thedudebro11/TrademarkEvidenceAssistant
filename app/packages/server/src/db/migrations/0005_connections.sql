-- Phase 5 schema: user-confirmed relationships between Evidence Items
-- (spec 07). Distinct from Phase 2's `duplicates` table: `duplicates`
-- holds deterministic, automatic exact-hash-match facts; `connections`
-- holds relationships the user asserts (spec 06 "Which other file
-- supports this answer?" / USER_JOURNEY.md "The user confirms
-- relationships"). The Scanner never writes here — see
-- docs/ARCHITECTURE_CONSTITUTION.md #7.
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  target_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  type TEXT NOT NULL,
  explanation TEXT NOT NULL,
  confidence TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_item_id, target_item_id, type)
);

CREATE INDEX IF NOT EXISTS idx_connections_source ON connections (source_item_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON connections (target_item_id);
