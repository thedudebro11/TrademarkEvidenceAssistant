-- Evidence Intelligence Phase 2: server-side batch analysis jobs and
-- explainable confirmed-example retrieval.
--
-- Nothing here changes what Phase 1 already guarantees: a batch job only
-- ever calls the existing per-item analysis pipeline (analysisService.ts's
-- startAnalysis), which only ever writes to analysis_runs/
-- evidence_suggestions/extracted_entities/date_assertions/
-- connection_suggestions — still never evidence_items, review_answers, or
-- connections. Confirmation remains a separate, explicit, per-item action
-- through the existing confirmAnalysisSuggestions path; nothing in this
-- migration or the service that uses it can bulk-confirm anything.

-- One row per "Analyze Selected / Analyze Folder / Analyze All Unreviewed
-- / Reanalyze Stale" click. Modeled directly on heic_backfill_jobs
-- (migrations 0012/0016) — created_at vs started_at split, an `error`
-- column for the failed/interrupted case, a bare-TEXT `status` column so
-- new terminal states never need a schema change.
CREATE TABLE IF NOT EXISTS batch_analysis_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'queued',
  selection_mode TEXT NOT NULL, -- 'selected_ids' | 'folder' | 'all_unreviewed' | 'stale' | 'retry_failed'
  selection_param TEXT,          -- folder path for 'folder'; source job id for 'retry_failed'; NULL otherwise
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  current_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  initiated_by TEXT NOT NULL DEFAULT 'user',
  cancellation_requested INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  -- Recorded at job creation so a completed job's report is honest about
  -- which rule/registry versions it ran under, even after a later
  -- analysisEngine.ts change would make the same selection re-classify
  -- differently — mirrors analysis_runs' own version columns.
  deterministic_rule_version TEXT NOT NULL,
  evidence_type_registry_version TEXT NOT NULL,
  provider_available INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_batch_analysis_jobs_workspace ON batch_analysis_jobs (workspace_id);
-- Powers duplicate-active-job prevention: "is there already a queued/
-- running job for this workspace."
CREATE INDEX IF NOT EXISTS idx_batch_analysis_jobs_workspace_status ON batch_analysis_jobs (workspace_id, status);

-- The stable selection snapshot itself, one row per item resolved into
-- the job at creation time (never re-resolved later, so the job stays
-- auditable even if the review queue changes mid-run — the whole point
-- of "record a stable selection snapshot"). Also the source of truth for
-- "retry failed items from a prior job" (WHERE job_id = ? AND status =
-- 'failed') and for per-item audit ("what happened to this specific
-- item in this specific batch").
CREATE TABLE IF NOT EXISTS batch_analysis_job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES batch_analysis_jobs(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'succeeded' | 'failed' | 'skipped'
  error TEXT,
  analysis_run_id INTEGER REFERENCES analysis_runs(id),
  processed_at TEXT,
  UNIQUE (job_id, evidence_item_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_analysis_job_items_job ON batch_analysis_job_items (job_id);
CREATE INDEX IF NOT EXISTS idx_batch_analysis_job_items_job_status ON batch_analysis_job_items (job_id, status);
CREATE INDEX IF NOT EXISTS idx_batch_analysis_job_items_item ON batch_analysis_job_items (evidence_item_id);

-- Explainable confirmed-example retrieval log — one row per (analysis
-- run, retrieved exemplar) pair, so every suggestion the review UI shows
-- can say exactly which of the user's own prior confirmed decisions
-- informed it, never an opaque "the model thinks so." Never itself a
-- suggestion or a confirmed value; purely explanatory/read-only data
-- alongside the run it was retrieved for.
CREATE TABLE IF NOT EXISTS analysis_retrieved_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),   -- the item being analyzed
  example_item_id TEXT NOT NULL REFERENCES evidence_items(id),    -- the confirmed exemplar retrieved
  example_evidence_type_id TEXT NOT NULL,                          -- the exemplar's own confirmed type, for display
  matched_signals_json TEXT NOT NULL DEFAULT '[]',                 -- e.g. ["Same folder: Customer Photos", "Same extension: heic"]
  influence_score REAL NOT NULL,                                   -- 0..1, how much this exemplar weighed into the top suggestion
  agreement TEXT NOT NULL,                                         -- 'supports' | 'contradicts' relative to the top evidence-type suggestion
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analysis_retrieved_examples_run ON analysis_retrieved_examples (analysis_run_id);
