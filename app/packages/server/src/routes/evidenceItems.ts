import { Router } from "express";
import { createReadStream, statSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  FILE_ROLES,
  REVIEW_DECISION_ACTIONS,
  type ConnectionType,
  type FileRole,
  type ReviewDecisionAction,
  type UsefulnessBand,
} from "@trademark-evidence-assistant/shared";
import * as reviewService from "../services/reviewService.js";
import { createConnection, removeConnection, ConnectionValidationError } from "../services/connectionService.js";
import { setOverride, clearOverride, ScoringValidationError } from "../services/scoringService.js";
import {
  confirmType,
  getSuggestion,
  InvalidEvidenceTypeError,
  saveInterviewAnswer,
  UnknownInterviewQuestionError,
} from "../services/evidenceTypeService.js";
import { saveDraft } from "../services/reviewDraftService.js";
import { extractTextFromItem, OcrError } from "../services/ocrService.js";
import { videoMetadataProvider } from "../services/videoMetadataProvider.js";
import type { ReviewDraftPayload } from "@trademark-evidence-assistant/shared";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";

/**
 * Thin routes: HTTP concerns only (status codes, request parsing).
 * All business logic — decision rules, navigation, file resolution —
 * lives in ReviewService, per docs/ARCHITECTURE_CONSTITUTION.md #2.
 */
export function createEvidenceItemsRouter(
  db: Database.Database,
  workspaceId: number,
  workspace: ResolvedWorkspace,
): Router {
  const router = Router();

  // Literal-path routes must be registered before the /:id routes below,
  // or Express would treat "progress"/"next"/"previous" as an :id value.
  router.get("/evidence-items/progress", (_req, res) => {
    res.status(200).json(reviewService.getProgress(db, workspaceId));
  });

  router.get("/evidence-items/next", (req, res) => {
    const currentId = typeof req.query.after === "string" ? req.query.after : null;
    const item = reviewService.getNextItem(db, workspaceId, currentId);
    if (!item) {
      res.status(204).end();
      return;
    }
    res.status(200).json(item);
  });

  router.get("/evidence-items/candidates", (req, res) => {
    const excludeId = typeof req.query.exclude === "string" ? req.query.exclude : "";
    res.status(200).json(reviewService.listConnectionCandidates(db, workspaceId, excludeId));
  });

  router.get("/evidence-items/tree", (_req, res) => {
    res.status(200).json(reviewService.buildEvidenceTree(db, workspaceId));
  });

  router.get("/evidence-items/previous", (req, res) => {
    const currentId = typeof req.query.before === "string" ? req.query.before : null;
    if (!currentId) {
      res.status(400).json({ error: "Query parameter 'before' is required" });
      return;
    }
    const item = reviewService.getPreviousItem(db, workspaceId, currentId);
    if (!item) {
      res.status(204).end();
      return;
    }
    res.status(200).json(item);
  });

  router.get("/evidence-items/:id", (req, res) => {
    const item = reviewService.getItemDetail(db, workspaceId, req.params.id);
    if (!item) {
      res.status(404).json({ error: "Evidence item not found" });
      return;
    }
    res.status(200).json(item);
  });

  router.get("/evidence-items/:id/file", (req, res) => {
    const resolved = reviewService.resolveItemFile(db, workspaceId, req.params.id, workspace.evidenceRoot);
    if (resolved.kind === "not_found") {
      res.status(404).json({ error: "Evidence item not found" });
      return;
    }
    if (resolved.kind === "missing") {
      res.status(404).json({ error: "The original file for this evidence item can no longer be found on disk" });
      return;
    }

    try {
      const stats = statSync(resolved.absolutePath);
      res.setHeader("Content-Type", resolved.mimeType);
      res.setHeader("Content-Length", String(stats.size));
      res.setHeader("Content-Disposition", "inline");
      const stream = createReadStream(resolved.absolutePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(500).json({ error: "This file could not be opened for preview" });
        }
      });
      stream.pipe(res);
    } catch {
      res.status(500).json({ error: "This file could not be opened for preview" });
    }
  });

  router.get("/evidence-items/:id/ocr", async (req, res) => {
    try {
      const result = await extractTextFromItem(db, workspaceId, req.params.id, workspace.evidenceRoot);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof OcrError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/evidence-items/:id/video-metadata", async (req, res) => {
    const resolved = reviewService.resolveItemFile(db, workspaceId, req.params.id, workspace.evidenceRoot);
    if (resolved.kind === "not_found") {
      res.status(404).json({ error: "Evidence item not found" });
      return;
    }
    if (resolved.kind === "missing") {
      res.status(404).json({ error: "The original file for this evidence item can no longer be found on disk" });
      return;
    }
    try {
      const metadata = await videoMetadataProvider.getVideoMetadata(resolved.absolutePath);
      res.status(200).json(metadata);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/evidence-items/:id/decision", (req, res) => {
    const action = req.body?.action as ReviewDecisionAction | undefined;
    if (!action || !REVIEW_DECISION_ACTIONS.includes(action)) {
      res.status(400).json({
        error: `Body field 'action' must be one of: ${REVIEW_DECISION_ACTIONS.join(", ")}`,
      });
      return;
    }
    try {
      const item = reviewService.recordDecision(db, workspaceId, req.params.id, action);
      res.status(200).json(item);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch("/evidence-items/:id/notes", (req, res) => {
    const notes = req.body?.notes;
    if (typeof notes !== "string") {
      res.status(400).json({ error: "Body field 'notes' must be a string" });
      return;
    }
    try {
      const result = reviewService.saveNotes(db, workspaceId, req.params.id, notes);
      res.status(200).json(result);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch("/evidence-items/:id/role", (req, res) => {
    const role = req.body?.role as FileRole | undefined;
    if (!role || !FILE_ROLES.includes(role)) {
      res.status(400).json({ error: `Body field 'role' must be one of: ${FILE_ROLES.join(", ")}` });
      return;
    }
    try {
      const item = reviewService.setFileRole(db, workspaceId, req.params.id, role);
      res.status(200).json(item);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/evidence-items/:id/draft", (req, res) => {
    const body = req.body ?? {};
    if (typeof body.notes !== "string") {
      res.status(400).json({ error: "Body field 'notes' must be a string" });
      return;
    }
    if (!Array.isArray(body.connectionsToAdd) || !Array.isArray(body.connectionIdsToRemove)) {
      res.status(400).json({ error: "Body fields 'connectionsToAdd' and 'connectionIdsToRemove' must be arrays" });
      return;
    }
    if (typeof body.interviewAnswers !== "object" || body.interviewAnswers === null || Array.isArray(body.interviewAnswers)) {
      res.status(400).json({ error: "Body field 'interviewAnswers' must be an object" });
      return;
    }
    const payload: ReviewDraftPayload = {
      evidenceType: body.evidenceType ?? null,
      interviewAnswers: body.interviewAnswers,
      connectionsToAdd: body.connectionsToAdd,
      connectionIdsToRemove: body.connectionIdsToRemove,
      noRelatedEvidence: Boolean(body.noRelatedEvidence),
      usefulnessOverride: body.usefulnessOverride ?? { action: "none", score: null, band: null, note: null },
      notes: body.notes,
      decisionAction: body.decisionAction ?? null,
    };

    try {
      const item = saveDraft(db, workspaceId, req.params.id, payload);
      res.status(200).json(item);
    } catch (err) {
      if (
        err instanceof InvalidEvidenceTypeError ||
        err instanceof UnknownInterviewQuestionError ||
        err instanceof ConnectionValidationError ||
        err instanceof ScoringValidationError
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.get("/evidence-items/:id/evidence-type-suggestion", (req, res) => {
    const suggestion = getSuggestion(db, workspaceId, req.params.id);
    if (!suggestion) {
      res.status(404).json({ error: "Evidence item not found" });
      return;
    }
    res.status(200).json(suggestion);
  });

  router.put("/evidence-items/:id/evidence-type", (req, res) => {
    const { typeId, source, confidence, reason } = req.body ?? {};
    if (typeof typeId !== "string" || !typeId) {
      res.status(400).json({ error: "Body field 'typeId' must be a non-empty string" });
      return;
    }
    if (source !== "suggested" && source !== "user") {
      res.status(400).json({ error: "Body field 'source' must be 'suggested' or 'user'" });
      return;
    }
    try {
      const item = confirmType(db, workspaceId, req.params.id, typeId, source, confidence ?? null, reason ?? null);
      res.status(200).json(item);
    } catch (err) {
      if (err instanceof InvalidEvidenceTypeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/evidence-items/:id/evidence-type-answers/:questionId", (req, res) => {
    const value = req.body?.value;
    const confidence = req.body?.confidence ?? null;
    const note = req.body?.note ?? null;
    if (typeof value !== "string") {
      res.status(400).json({ error: "Body field 'value' must be a string" });
      return;
    }
    try {
      const answer = saveInterviewAnswer(db, workspaceId, req.params.id, req.params.questionId, {
        value,
        confidence,
        note,
      });
      res.status(200).json(answer);
    } catch (err) {
      if (err instanceof UnknownInterviewQuestionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.put("/evidence-items/:id/answers/:questionId", (req, res) => {
    const value = req.body?.value;
    const confidence = req.body?.confidence ?? null;
    const note = req.body?.note ?? null;
    if (typeof value !== "string") {
      res.status(400).json({ error: "Body field 'value' must be a string" });
      return;
    }
    try {
      const answer = reviewService.saveAnswer(db, workspaceId, req.params.id, req.params.questionId, {
        value,
        confidence,
        note,
      });
      res.status(200).json(answer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.post("/evidence-items/:id/connections", (req, res) => {
    const { targetPath, type, explanation, confidence } = req.body ?? {};
    if (typeof targetPath !== "string" || !targetPath) {
      res.status(400).json({ error: "Body field 'targetPath' must be a non-empty string" });
      return;
    }
    try {
      const connection = createConnection(db, workspaceId, req.params.id, targetPath, {
        type: type as ConnectionType,
        explanation,
        confidence: confidence ?? null,
      });
      res.status(201).json(connection);
    } catch (err) {
      if (err instanceof ConnectionValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/connections/:connectionId", (req, res) => {
    const connectionId = Number(req.params.connectionId);
    if (!Number.isInteger(connectionId)) {
      res.status(400).json({ error: "connectionId must be an integer" });
      return;
    }
    try {
      removeConnection(db, workspaceId, connectionId);
      res.status(204).end();
    } catch (err) {
      if (err instanceof ConnectionValidationError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/evidence-items/:id/usefulness-override", (req, res) => {
    const { score, band, note } = req.body ?? {};
    try {
      setOverride(db, workspaceId, req.params.id, score, band as UsefulnessBand, note);
      const item = reviewService.getItemDetail(db, workspaceId, req.params.id);
      res.status(200).json(item);
    } catch (err) {
      if (err instanceof ScoringValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/evidence-items/:id/usefulness-override", (req, res) => {
    try {
      clearOverride(db, workspaceId, req.params.id);
      const item = reviewService.getItemDetail(db, workspaceId, req.params.id);
      res.status(200).json(item);
    } catch (err) {
      if (err instanceof ScoringValidationError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
