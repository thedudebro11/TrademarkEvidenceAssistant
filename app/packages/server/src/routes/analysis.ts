import { Router } from "express";
import type Database from "better-sqlite3";
import type { ConfirmAnalysisRequest } from "@trademark-evidence-assistant/shared";
import { AnalysisItemNotFoundError, AnalysisRunNotFoundError, AnalysisValidationError, confirmAnalysisSuggestions, getLatestAnalysis, startAnalysis } from "../services/analysisService.js";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";

/** Thin routes only — all analysis/confirmation logic lives in analysisService.ts, per docs/ARCHITECTURE_CONSTITUTION.md #2. */
export function createAnalysisRouter(db: Database.Database, workspaceId: number, workspace: ResolvedWorkspace): Router {
  const router = Router();

  router.post("/evidence-items/:id/analysis", async (req, res) => {
    try {
      const result = await startAnalysis(db, workspaceId, req.params.id, { evidenceRoot: workspace.evidenceRoot });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AnalysisItemNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/evidence-items/:id/analysis", (req, res) => {
    const result = getLatestAnalysis(db, workspaceId, req.params.id);
    if (!result) {
      res.status(404).json({ error: "No analysis has been run for this evidence item yet" });
      return;
    }
    res.status(200).json(result);
  });

  router.post("/evidence-items/:id/analysis/confirm", (req, res) => {
    const body = req.body as Partial<ConfirmAnalysisRequest> | undefined;
    if (typeof body?.analysisRunId !== "number") {
      res.status(400).json({ error: "Body field 'analysisRunId' is required" });
      return;
    }
    if (!Array.isArray(body.acceptedAnswers) || !Array.isArray(body.rejectedSuggestionIds) || !Array.isArray(body.acceptedConnectionSuggestionIds) || !Array.isArray(body.rejectedConnectionSuggestionIds)) {
      res.status(400).json({ error: "Body fields 'acceptedAnswers', 'rejectedSuggestionIds', 'acceptedConnectionSuggestionIds', and 'rejectedConnectionSuggestionIds' must all be arrays" });
      return;
    }
    try {
      const result = confirmAnalysisSuggestions(db, workspaceId, req.params.id, {
        analysisRunId: body.analysisRunId,
        acceptedEvidenceTypeSuggestionId: body.acceptedEvidenceTypeSuggestionId ?? null,
        acceptedAnswers: body.acceptedAnswers,
        rejectedSuggestionIds: body.rejectedSuggestionIds,
        acceptedConnectionSuggestionIds: body.acceptedConnectionSuggestionIds,
        rejectedConnectionSuggestionIds: body.rejectedConnectionSuggestionIds,
      });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AnalysisItemNotFoundError || err instanceof AnalysisRunNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof AnalysisValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
