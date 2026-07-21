import { Router } from "express";
import type Database from "better-sqlite3";
import type { StartBatchAnalysisRequest, SuggestionQueueFilters } from "@trademark-evidence-assistant/shared";
import { SUGGESTION_CONFIDENCES } from "@trademark-evidence-assistant/shared";
import {
  BatchAnalysisJobNotFoundError,
  BatchAnalysisValidationError,
  getBatchAnalysisJobStatus,
  previewBatchAnalysisSelection,
  requestBatchAnalysisCancellation,
  startBatchAnalysis,
} from "../services/batchAnalysisService.js";
import { getSuggestionQueue } from "../services/reviewSuggestionsQueueService.js";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";

const SELECTION_MODES = new Set(["selected_ids", "folder", "all_unreviewed", "stale", "retry_failed"]);

function parseSelectionRequest(body: unknown): StartBatchAnalysisRequest | null {
  const b = body as Partial<StartBatchAnalysisRequest> | undefined;
  if (!b || typeof b.selectionMode !== "string" || !SELECTION_MODES.has(b.selectionMode)) return null;
  const selectionMode = b.selectionMode as StartBatchAnalysisRequest["selectionMode"];
  if (selectionMode === "selected_ids" && (!Array.isArray(b.itemIds) || b.itemIds.some((id) => typeof id !== "string"))) return null;
  if (selectionMode === "folder" && typeof b.folderPath !== "string") return null;
  if (selectionMode === "retry_failed" && typeof b.sourceJobId !== "number") return null;
  return { selectionMode, itemIds: b.itemIds, folderPath: b.folderPath, sourceJobId: b.sourceJobId };
}

/** Thin routes only — all batch-job and queue logic lives in batchAnalysisService.ts/reviewSuggestionsQueueService.ts, per docs/ARCHITECTURE_CONSTITUTION.md #2. */
export function createBatchAnalysisRouter(db: Database.Database, workspaceId: number, workspace: ResolvedWorkspace): Router {
  const router = Router();
  const paths = { evidenceRoot: workspace.evidenceRoot };

  router.post("/analysis/batch/preview", (req, res) => {
    const request = parseSelectionRequest(req.body);
    if (!request) {
      res.status(400).json({ error: "A valid 'selectionMode' (and its required parameters) is required" });
      return;
    }
    try {
      res.status(200).json(previewBatchAnalysisSelection(db, workspaceId, request));
    } catch (err) {
      if (err instanceof BatchAnalysisValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof BatchAnalysisJobNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/analysis/batch", async (req, res) => {
    const request = parseSelectionRequest(req.body);
    if (!request) {
      res.status(400).json({ error: "A valid 'selectionMode' (and its required parameters) is required" });
      return;
    }
    try {
      const jobId = await startBatchAnalysis(db, workspaceId, paths, request);
      res.status(202).json({ jobId });
    } catch (err) {
      if (err instanceof BatchAnalysisValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof BatchAnalysisJobNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/analysis/batch/:jobId", (req, res) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId)) {
      res.status(400).json({ error: "jobId must be an integer" });
      return;
    }
    const status = getBatchAnalysisJobStatus(db, workspaceId, jobId);
    if (!status) {
      res.status(404).json({ error: "Batch analysis job not found" });
      return;
    }
    res.status(200).json(status);
  });

  router.post("/analysis/batch/:jobId/cancel", (req, res) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId)) {
      res.status(400).json({ error: "jobId must be an integer" });
      return;
    }
    const ok = requestBatchAnalysisCancellation(db, workspaceId, jobId);
    if (!ok) {
      res.status(404).json({ error: "No cancellable (queued or running) batch analysis job found with this id" });
      return;
    }
    res.status(202).json({ jobId, cancellationRequested: true });
  });

  router.get("/analysis/suggestions-queue", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const minConfidence = q.minConfidence;
    if (minConfidence !== undefined && !SUGGESTION_CONFIDENCES.includes(minConfidence as (typeof SUGGESTION_CONFIDENCES)[number])) {
      res.status(400).json({ error: "minConfidence must be one of: " + SUGGESTION_CONFIDENCES.join(", ") });
      return;
    }
    const filters: SuggestionQueueFilters = {
      jobId: q.jobId !== undefined ? Number(q.jobId) : undefined,
      evidenceType: q.evidenceType,
      folder: q.folder,
      minConfidence: minConfidence as SuggestionQueueFilters["minConfidence"],
      unresolvedCustomerStatus: q.unresolvedCustomerStatus === "true",
      hasContradiction: q.hasContradiction === "true",
      hasConnections: q.hasConnections === "true",
      failedExtraction: q.failedExtraction === "true",
      stale: q.stale === "true",
      noProvider: q.noProvider === "true",
    };
    res.status(200).json(getSuggestionQueue(db, workspaceId, filters));
  });

  return router;
}
