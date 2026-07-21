import { Router } from "express";
import type Database from "better-sqlite3";
import type { ArchiveSimilarApplyRequest, ArchiveSimilarPreviewRequest, ArchiveSimilarReviewTemplate } from "@trademark-evidence-assistant/shared";
import { applyArchiveSimilar, BulkOperationNotFoundError, BulkReviewValidationError, previewArchiveSimilar, undoArchiveSimilar } from "../services/bulkReviewService.js";

/** Thin routes only — all eligibility/apply/undo logic lives in bulkReviewService.ts, per docs/ARCHITECTURE_CONSTITUTION.md #2. */
export function createBulkReviewRouter(db: Database.Database, workspaceId: number): Router {
  const router = Router();

  function parseReviewTemplate(body: unknown): ArchiveSimilarReviewTemplate | null {
    const t = (body as { reviewTemplate?: unknown } | null)?.reviewTemplate as Partial<ArchiveSimilarReviewTemplate> | undefined;
    if (!t || typeof t.evidenceTypeId !== "string" || typeof t.answers !== "object" || t.answers === null || typeof t.decisionAction !== "string") {
      return null;
    }
    return { evidenceTypeId: t.evidenceTypeId, answers: t.answers as ArchiveSimilarReviewTemplate["answers"], decisionAction: t.decisionAction as ArchiveSimilarReviewTemplate["decisionAction"] };
  }

  router.post("/evidence-items/:id/archive-similar/preview", (req, res) => {
    const reviewTemplate = parseReviewTemplate(req.body as ArchiveSimilarPreviewRequest);
    if (!reviewTemplate) {
      res.status(400).json({ error: "Body field 'reviewTemplate' must include evidenceTypeId, answers, and decisionAction" });
      return;
    }
    try {
      const result = previewArchiveSimilar(db, workspaceId, req.params.id, reviewTemplate);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof BulkReviewValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/evidence-items/:id/archive-similar/apply", (req, res) => {
    const body = req.body as Partial<ArchiveSimilarApplyRequest> | undefined;
    const reviewTemplate = parseReviewTemplate(body);
    if (!reviewTemplate) {
      res.status(400).json({ error: "Body field 'reviewTemplate' must include evidenceTypeId, answers, and decisionAction" });
      return;
    }
    if (!Array.isArray(body?.selectedItemIds)) {
      res.status(400).json({ error: "Body field 'selectedItemIds' must be an array" });
      return;
    }
    if (typeof body?.idempotencyKey !== "string" || !body.idempotencyKey) {
      res.status(400).json({ error: "Body field 'idempotencyKey' is required" });
      return;
    }
    try {
      const result = applyArchiveSimilar(db, workspaceId, {
        sourceItemId: req.params.id,
        selectedItemIds: body.selectedItemIds,
        reviewTemplate,
        archiveCurrentItem: Boolean(body.archiveCurrentItem),
        sourceItemPayload: body.sourceItemPayload,
        idempotencyKey: body.idempotencyKey,
        dateConfidence: body.dateConfidence,
      });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof BulkReviewValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/bulk-operations/:operationId/undo", (req, res) => {
    const operationId = Number(req.params.operationId);
    if (!Number.isInteger(operationId)) {
      res.status(400).json({ error: "operationId must be an integer" });
      return;
    }
    try {
      const result = undoArchiveSimilar(db, workspaceId, operationId);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof BulkOperationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
