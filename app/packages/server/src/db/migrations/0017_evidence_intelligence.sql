-- Evidence Intelligence Phase 1: analysis runs, staged suggestions,
-- extracted entities, date assertions, and connection suggestions.
--
-- Nothing in this schema is ever written directly into a confirmed
-- review field (evidence_items.evidence_type_id, review_answers,
-- connections). Every table here holds *proposed* data only — the
-- existing saveDraftWithTx/confirmType/saveInterviewAnswer path
-- (reviewDraftService.ts) remains the sole way a value becomes
-- confirmed, exactly as it already is for manual review. See
-- analysisService.ts's confirmSuggestions for the one place these two
-- worlds meet.
--
-- All five tables key off evidence_item_id with a plain FK (this
-- database runs PRAGMA foreign_keys = ON), so missingRecordsService.ts's
-- deleteDependentRows must also delete from these tables before it can
-- delete the evidence_items row itself — added there alongside every
-- other dependent table, same pattern.

-- One row per "Analyze Evidence" click (or reanalysis). Never
-- overwritten in place — a fingerprint/registry-version change starts a
-- new run, and analysisService.ts marks the previous run (and its
-- still-proposed suggestions) superseded rather than deleting anything,
-- per "Do not overwrite old runs."
CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  source_fingerprint TEXT NOT NULL,
  metadata_version TEXT NOT NULL,
  evidence_type_registry_version TEXT NOT NULL,
  question_registry_version TEXT NOT NULL,
  deterministic_rule_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  initiated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  provider_id TEXT,
  provider_model TEXT,
  provider_version TEXT,
  error TEXT,
  -- Set when a *later* run for the same evidence item is created —
  -- this run's still-'proposed'/'edited' suggestions are moved to
  -- 'superseded' in the same transaction. Distinct from an individual
  -- suggestion going 'stale' (computed live — see analysisService.ts's
  -- computeRunStaleness — from a fingerprint/registry-version mismatch
  -- against the item's *current* state, never stored, so it can never
  -- drift the way a cached boolean could).
  superseded_at TEXT,
  superseded_by_run_id INTEGER REFERENCES analysis_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_item ON analysis_runs (evidence_item_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_workspace ON analysis_runs (workspace_id);

-- Staged evidence-type and question-answer suggestions. Never the
-- source of truth for a confirmed value — evidence_items.evidence_type_id
-- and review_answers remain that, exactly as before this feature existed.
CREATE TABLE IF NOT EXISTS evidence_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id),
  field_kind TEXT NOT NULL, -- 'evidence_type' | 'question_answer'
  field_id TEXT,            -- question id for 'question_answer'; NULL for 'evidence_type'
  proposed_value TEXT NOT NULL,
  normalized_value TEXT,
  confidence TEXT NOT NULL, -- 'high' | 'medium' | 'low'
  rationale TEXT NOT NULL,
  supporting_signals_json TEXT NOT NULL DEFAULT '[]',
  source_locations_json TEXT NOT NULL DEFAULT '[]',
  generation_method TEXT NOT NULL, -- 'deterministic' | 'ai_provider'
  state TEXT NOT NULL DEFAULT 'proposed', -- proposed|edited|accepted|rejected|unresolved|superseded|stale
  user_correction TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_suggestions_item ON evidence_suggestions (evidence_item_id);
CREATE INDEX IF NOT EXISTS idx_evidence_suggestions_run ON evidence_suggestions (analysis_run_id);

-- Deterministic entity extraction (order/shipment/tracking numbers,
-- SKUs, product attributes, the FATLETIC mark itself, etc). Read-only
-- data for the UI and for connection-suggestion matching — never
-- written into any confirmed field.
CREATE TABLE IF NOT EXISTS extracted_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id),
  entity_type TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  normalized_value TEXT,
  source_location TEXT,
  extraction_method TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_extracted_entities_item ON extracted_entities (evidence_item_id);
CREATE INDEX IF NOT EXISTS idx_extracted_entities_run ON extracted_entities (analysis_run_id);
-- Powers exact-identifier connection matching (analysisService.ts) —
-- "every other item with this same order/shipment/tracking/SKU value."
CREATE INDEX IF NOT EXISTS idx_extracted_entities_type_value ON extracted_entities (entity_type, normalized_value);

-- Separate, provenanced date assertions — deliberately never collapsed
-- into one "evidence date." See docs comment on analysisEngine.ts.
CREATE TABLE IF NOT EXISTS date_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id),
  source_type TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  normalized_value TEXT,
  timezone_status TEXT NOT NULL DEFAULT 'not_applicable', -- 'known' | 'unknown' | 'not_applicable'
  source_location TEXT,
  confidence TEXT NOT NULL,
  conflict_state TEXT NOT NULL DEFAULT 'none', -- 'none' | 'conflicts_with_other_assertion'
  confirmation_state TEXT NOT NULL DEFAULT 'unconfirmed', -- 'unconfirmed' | 'confirmed'
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_date_assertions_item ON date_assertions (evidence_item_id);
CREATE INDEX IF NOT EXISTS idx_date_assertions_run ON date_assertions (analysis_run_id);

-- Strong, deterministic, exact-identifier-based connection proposals
-- only (Phase 1 scope — see docs comment on analysisService.ts).
-- Never auto-applied to the `connections` table; a UNIQUE constraint
-- prevents a duplicate suggestion for the same source/target/type/
-- identifier pair from ever being staged twice.
CREATE TABLE IF NOT EXISTS connection_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  source_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  target_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id),
  proposed_type TEXT NOT NULL,
  matched_identifier_type TEXT NOT NULL,
  matched_identifier_value TEXT NOT NULL,
  confidence TEXT NOT NULL,
  rationale TEXT NOT NULL,
  contradiction_warning TEXT,
  state TEXT NOT NULL DEFAULT 'proposed', -- proposed|accepted|rejected|superseded|stale
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  UNIQUE (source_item_id, target_item_id, proposed_type, matched_identifier_value)
);
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_source ON connection_suggestions (source_item_id);
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_target ON connection_suggestions (target_item_id);
