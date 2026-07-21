import { dirname } from "node:path";
import type Database from "better-sqlite3";
import type { BatchAnalysisJobStatus, BatchAnalysisSelectionPreview, SelectionMode, StartBatchAnalysisRequest } from "@trademark-evidence-assistant/shared";
import { EVIDENCE_TYPE_REGISTRY_META } from "@trademark-evidence-assistant/shared";
import { DETERMINISTIC_RULE_VERSION } from "../engines/analysisEngine.js";
import { runWithConcurrency } from "../utils/concurrency.js";
import { getConfiguredAnalysisProvider } from "./analysisProvider.js";
import { isLatestAnalysisStale, startAnalysis, type AnalysisPaths } from "./analysisService.js";

/**
 * Evidence Intelligence Phase 2 — server-side batch analysis jobs.
 * Directly modeled on heicPreviewService.ts's backfill job (same
 * created_at/started_at split, same `error`/error_summary column, same
 * abandoned-job reconciliation via a per-process "genuinely running"
 * set, same bounded-concurrency + per-item timeout + failure-isolation
 * pattern). The one thing this module is never allowed to do is call
 * anything other than `startAnalysis` — the exact same Phase 1 function
 * the current-item "Analyze Evidence" button calls — so a batch job can
 * never confirm a type, overwrite an answer, create a permanent
 * connection, change inclusion, alter notes, or remove evidence: those
 * guarantees live entirely in analysisService.ts and are untouched here.
 */

export class BatchAnalysisValidationError extends Error {}
export class BatchAnalysisJobNotFoundError extends Error {}

// Verified against real FATLETIC evidence during Phase 2 acceptance
// testing: a genuine, non-hung single-item analysis of a real ~5MB
// product photo (OCR-bound, not a hang) took ~50.6s end to end. 45s was
// too tight and produced real, reproducible "Analysis timed out"
// failures under concurrent load; 120s gives real large-photo OCR
// headroom while still bounding a genuinely hung/broken decode.
const PER_ITEM_ANALYSIS_TIMEOUT_MS = 120_000;
const NON_TERMINAL_STATUSES = ["queued", "running"] as const;

interface SelectionCandidate {
  id: string;
  missing: boolean;
}

interface EvidenceItemForSelection {
  id: string;
  original_path: string;
  extension: string;
  missing_since: string | null;
}

function allWorkspaceItems(db: Database.Database, workspaceId: number): EvidenceItemForSelection[] {
  return db.prepare("SELECT id, original_path, extension, missing_since FROM evidence_items WHERE workspace_id = ?").all(workspaceId) as EvidenceItemForSelection[];
}

function folderOf(originalPath: string): string {
  const d = dirname(originalPath);
  return d === "." ? "" : d;
}

/**
 * Resolves a selection mode into the concrete, ordered list of item ids
 * this job snapshot will contain — done once, at job creation, never
 * re-resolved later (that's what makes the snapshot in
 * batch_analysis_job_items stable/auditable even if the review queue
 * changes while the job runs).
 */
function resolveSelection(db: Database.Database, workspaceId: number, request: StartBatchAnalysisRequest): SelectionCandidate[] {
  switch (request.selectionMode) {
    case "selected_ids": {
      const requested = Array.from(new Set(request.itemIds ?? []));
      if (requested.length === 0) throw new BatchAnalysisValidationError("selectionMode 'selected_ids' requires at least one item id");
      const rows = allWorkspaceItems(db, workspaceId);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const resolved: SelectionCandidate[] = [];
      for (const id of requested) {
        const row = byId.get(id);
        if (row) resolved.push({ id: row.id, missing: row.missing_since !== null });
      }
      if (resolved.length === 0) throw new BatchAnalysisValidationError("None of the requested item ids exist in this workspace");
      return resolved;
    }
    case "folder": {
      const folderPath = request.folderPath ?? "";
      const rows = allWorkspaceItems(db, workspaceId).filter((r) => folderOf(r.original_path) === folderPath);
      return rows.map((r) => ({ id: r.id, missing: r.missing_since !== null }));
    }
    case "all_unreviewed": {
      // Read live from the database every call — never a cached/hardcoded count.
      const rows = db.prepare("SELECT id, missing_since FROM evidence_items WHERE workspace_id = ? AND review_status = 'unreviewed'").all(workspaceId) as {
        id: string;
        missing_since: string | null;
      }[];
      return rows.map((r) => ({ id: r.id, missing: r.missing_since !== null }));
    }
    case "stale": {
      const rows = allWorkspaceItems(db, workspaceId);
      return rows.filter((r) => r.missing_since === null && isLatestAnalysisStale(db, workspaceId, r.id) === true).map((r) => ({ id: r.id, missing: false }));
    }
    case "retry_failed": {
      if (request.sourceJobId === undefined) throw new BatchAnalysisValidationError("selectionMode 'retry_failed' requires sourceJobId");
      const sourceJob = db.prepare("SELECT id FROM batch_analysis_jobs WHERE id = ? AND workspace_id = ?").get(request.sourceJobId, workspaceId);
      if (!sourceJob) throw new BatchAnalysisJobNotFoundError(`Batch analysis job ${request.sourceJobId} not found`);
      const rows = db.prepare("SELECT evidence_item_id FROM batch_analysis_job_items WHERE job_id = ? AND status = 'failed'").all(request.sourceJobId) as { evidence_item_id: string }[];
      const itemRows = allWorkspaceItems(db, workspaceId);
      const byId = new Map(itemRows.map((r) => [r.id, r]));
      return rows.map((r) => byId.get(r.evidence_item_id)).filter((r): r is EvidenceItemForSelection => r !== undefined).map((r) => ({ id: r.id, missing: r.missing_since !== null }));
    }
  }
}

/**
 * Pre-run report for a selection, without starting anything — powers
 * the "before running, report: number of eligible records, folders
 * represented, file-type breakdown, estimated workload, any unreadable
 * files" requirement.
 */
export function previewBatchAnalysisSelection(db: Database.Database, workspaceId: number, request: StartBatchAnalysisRequest): BatchAnalysisSelectionPreview {
  const candidates = resolveSelection(db, workspaceId, request);
  const rows = allWorkspaceItems(db, workspaceId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const folders = new Set<string>();
  const fileTypeBreakdown: Record<string, number> = {};
  let unreadableCount = 0;
  let eligibleCount = 0;
  for (const c of candidates) {
    const row = byId.get(c.id);
    if (!row) continue;
    if (c.missing) {
      unreadableCount++;
      continue;
    }
    eligibleCount++;
    folders.add(folderOf(row.original_path) || "(root)");
    const ext = row.extension.toLowerCase() || "(none)";
    fileTypeBreakdown[ext] = (fileTypeBreakdown[ext] ?? 0) + 1;
  }
  return { eligibleCount, folders: [...folders].sort(), fileTypeBreakdown, unreadableCount };
}

/** Job ids this *process* is actively running the background loop for — see heicPreviewService.ts's `jobsRunningInThisProcess` for the identical rationale. */
const jobsRunningInThisProcess = new Set<number>();

/** Marks any `batch_analysis_jobs` row still in a non-terminal status but not in `jobsRunningInThisProcess` as `'interrupted'` — a job a previous process instance started and never finished. Called at the start of every `startBatchAnalysis`. */
export function reconcileAbandonedBatchAnalysisJobs(db: Database.Database, workspaceId: number): void {
  const placeholders = NON_TERMINAL_STATUSES.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT id FROM batch_analysis_jobs WHERE workspace_id = ? AND status IN (${placeholders})`).all(workspaceId, ...NON_TERMINAL_STATUSES) as { id: number }[];
  for (const row of rows) {
    if (jobsRunningInThisProcess.has(row.id)) continue;
    db.prepare("UPDATE batch_analysis_jobs SET status = 'interrupted', finished_at = datetime('now'), error_summary = ? WHERE id = ?").run(
      "The server restarted while this job was running",
      row.id,
    );
  }
}

function mapJobRow(row: JobRow): BatchAnalysisJobStatus {
  return {
    id: row.id,
    status: row.status as BatchAnalysisJobStatus["status"],
    selectionMode: row.selection_mode as SelectionMode,
    selectionParam: row.selection_param,
    totalCount: row.total_count,
    processedCount: row.processed_count,
    succeededCount: row.succeeded_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    currentItemId: row.current_item_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancellationRequested: row.cancellation_requested === 1,
    errorSummary: row.error_summary,
    deterministicRuleVersion: row.deterministic_rule_version,
    evidenceTypeRegistryVersion: row.evidence_type_registry_version,
    providerAvailable: row.provider_available === 1,
    readyForReview: row.status === "completed" || row.status === "completed_with_failures",
  };
}

interface JobRow {
  id: number;
  workspace_id: number;
  status: string;
  selection_mode: string;
  selection_param: string | null;
  total_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  skipped_count: number;
  current_item_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  cancellation_requested: number;
  error_summary: string | null;
  deterministic_rule_version: string;
  evidence_type_registry_version: string;
  provider_available: number;
}

export function getBatchAnalysisJobStatus(db: Database.Database, workspaceId: number, jobId: number): BatchAnalysisJobStatus | null {
  const row = db.prepare("SELECT * FROM batch_analysis_jobs WHERE id = ? AND workspace_id = ?").get(jobId, workspaceId) as JobRow | undefined;
  return row ? mapJobRow(row) : null;
}

/** Sets the cancellation flag a running job's loop checks between items — cancellation always takes effect between items, never mid-item (never partially processes one item). Returns `false` if the job doesn't exist or is already terminal. */
export function requestBatchAnalysisCancellation(db: Database.Database, workspaceId: number, jobId: number): boolean {
  const row = db.prepare("SELECT status FROM batch_analysis_jobs WHERE id = ? AND workspace_id = ?").get(jobId, workspaceId) as { status: string } | undefined;
  if (!row || !(NON_TERMINAL_STATUSES as readonly string[]).includes(row.status)) return false;
  db.prepare("UPDATE batch_analysis_jobs SET cancellation_requested = 1 WHERE id = ?").run(jobId);
  return true;
}

async function analyzeOneWithTimeout(db: Database.Database, workspaceId: number, itemId: string, paths: AnalysisPaths): Promise<void> {
  await Promise.race([
    startAnalysis(db, workspaceId, itemId, paths),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Analysis timed out")), PER_ITEM_ANALYSIS_TIMEOUT_MS)),
  ]);
}

/**
 * Starts a batch analysis job for the given selection. Returns
 * immediately with a job id; processing runs in the background.
 * Idempotent in the same two senses as the HEIC backfill: re-analyzing
 * an item that already has a current (non-stale) analysis just produces
 * another superseding run through the ordinary Phase 1 semantics — safe,
 * never duplicative of confirmed data — and a second call while a job
 * for this workspace is still genuinely active returns that *same* job
 * id rather than starting a concurrent duplicate.
 */
export async function startBatchAnalysis(db: Database.Database, workspaceId: number, paths: AnalysisPaths, request: StartBatchAnalysisRequest, concurrency = 3): Promise<number> {
  reconcileAbandonedBatchAnalysisJobs(db, workspaceId);

  const placeholders = NON_TERMINAL_STATUSES.map(() => "?").join(", ");
  const activeJob = db.prepare(`SELECT id FROM batch_analysis_jobs WHERE workspace_id = ? AND status IN (${placeholders}) ORDER BY id DESC LIMIT 1`).get(workspaceId, ...NON_TERMINAL_STATUSES) as
    | { id: number }
    | undefined;
  if (activeJob) return activeJob.id;

  const candidates = resolveSelection(db, workspaceId, request);
  const toProcess = candidates.filter((c) => !c.missing);
  const skippedCount = candidates.length - toProcess.length;

  const provider = getConfiguredAnalysisProvider();
  const capability = await provider.checkAvailability();

  const selectionParam = request.selectionMode === "folder" ? (request.folderPath ?? "") : request.selectionMode === "retry_failed" ? String(request.sourceJobId) : null;

  const jobId = db
    .prepare(
      `INSERT INTO batch_analysis_jobs
         (workspace_id, status, selection_mode, selection_param, total_count, skipped_count, started_at,
          deterministic_rule_version, evidence_type_registry_version, provider_available)
       VALUES (?, 'running', ?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
    )
    .run(workspaceId, request.selectionMode, selectionParam, candidates.length, skippedCount, DETERMINISTIC_RULE_VERSION, EVIDENCE_TYPE_REGISTRY_META.version, capability.available ? 1 : 0)
    .lastInsertRowid as number;

  const insertItem = db.prepare("INSERT INTO batch_analysis_job_items (job_id, evidence_item_id, status, processed_at) VALUES (?, ?, ?, ?)");
  const insertMany = db.transaction((items: SelectionCandidate[]) => {
    for (const c of items) {
      insertItem.run(jobId, c.id, c.missing ? "skipped" : "pending", c.missing ? new Date().toISOString() : null);
    }
  });
  insertMany(candidates);

  jobsRunningInThisProcess.add(jobId);

  void (async () => {
    let succeeded = 0;
    let failed = 0;
    let processed = 0;
    let canceled = false;

    try {
      await runWithConcurrency(toProcess, concurrency, async (candidate) => {
        // Cancellation takes effect *between* items only — an item
        // already handed to a worker always finishes (or fails/times
        // out) normally; nothing here ever aborts mid-item, so there is
        // never a half-written analysis run.
        const job = db.prepare("SELECT cancellation_requested FROM batch_analysis_jobs WHERE id = ?").get(jobId) as { cancellation_requested: number };
        if (job.cancellation_requested === 1) {
          canceled = true;
          db.prepare("UPDATE batch_analysis_job_items SET status = 'skipped', error = ?, processed_at = datetime('now') WHERE job_id = ? AND evidence_item_id = ?").run(
            "Canceled before this item was processed",
            jobId,
            candidate.id,
          );
          return;
        }

        db.prepare("UPDATE batch_analysis_jobs SET current_item_id = ? WHERE id = ?").run(candidate.id, jobId);
        try {
          await analyzeOneWithTimeout(db, workspaceId, candidate.id, paths);
          succeeded++;
          const runRow = db.prepare("SELECT id FROM analysis_runs WHERE evidence_item_id = ? ORDER BY id DESC LIMIT 1").get(candidate.id) as { id: number } | undefined;
          db.prepare("UPDATE batch_analysis_job_items SET status = 'succeeded', analysis_run_id = ?, processed_at = datetime('now') WHERE job_id = ? AND evidence_item_id = ?").run(
            runRow?.id ?? null,
            jobId,
            candidate.id,
          );
        } catch (err) {
          failed++;
          const message = err instanceof Error ? err.message : String(err);
          db.prepare("UPDATE batch_analysis_job_items SET status = 'failed', error = ?, processed_at = datetime('now') WHERE job_id = ? AND evidence_item_id = ?").run(message, jobId, candidate.id);
        }

        processed++;
        // Persisted after every single item — a client polling mid-batch
        // always sees real progress, and an interrupted job still has an
        // accurate count of what it actually got to.
        db.prepare("UPDATE batch_analysis_jobs SET processed_count = ?, succeeded_count = ?, failed_count = ?, current_item_id = NULL WHERE id = ?").run(processed, succeeded, failed, jobId);
      });

      const finalStatus: BatchAnalysisJobStatus["status"] = canceled ? "canceled" : failed > 0 ? "completed_with_failures" : "completed";
      db.prepare("UPDATE batch_analysis_jobs SET status = ?, finished_at = datetime('now'), current_item_id = NULL WHERE id = ?").run(finalStatus, jobId);
    } catch (err) {
      db.prepare("UPDATE batch_analysis_jobs SET status = 'failed', finished_at = datetime('now'), current_item_id = NULL, error_summary = ? WHERE id = ?").run(
        err instanceof Error ? err.message : String(err),
        jobId,
      );
      // eslint-disable-next-line no-console
      console.error("Batch analysis job failed unexpectedly:", err instanceof Error ? err.message : err);
    } finally {
      jobsRunningInThisProcess.delete(jobId);
    }
  })();

  return jobId;
}
