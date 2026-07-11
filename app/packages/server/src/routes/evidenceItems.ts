import { Router } from "express";
import { createReadStream, statSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  FILE_ROLES,
  REVIEW_DECISION_ACTIONS,
  type FileRole,
  type ReviewDecisionAction,
} from "@trademark-evidence-assistant/shared";
import * as reviewService from "../services/reviewService.js";
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

  return router;
}
