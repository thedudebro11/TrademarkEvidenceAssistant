import { Router } from "express";
import type Database from "better-sqlite3";
import type { RemoveMissingRecordsRequest } from "@trademark-evidence-assistant/shared";
import {
  MissingRecordsOperationNotFoundError,
  MissingRecordsValidationError,
  previewMissingRecords,
  removeMissingRecords,
  undoMissingRecordsRemoval,
} from "../services/missingRecordsService.js";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";

/** Thin routes only — all eligibility/removal/undo logic lives in missingRecordsService.ts, per docs/ARCHITECTURE_CONSTITUTION.md #2. */
export function createMissingRecordsRouter(db: Database.Database, workspaceId: number, workspace: ResolvedWorkspace): Router {
  const router = Router();

  router.get("/missing-records/preview", (_req, res) => {
    try {
      const result = previewMissingRecords(db, workspaceId, workspace.evidenceRoot);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/missing-records/remove", (req, res) => {
    const body = req.body as Partial<RemoveMissingRecordsRequest> | undefined;
    if (!Array.isArray(body?.evidenceItemIds) || body.evidenceItemIds.length === 0) {
      res.status(400).json({ error: "Body field 'evidenceItemIds' must be a non-empty array" });
      return;
    }
    if (typeof body?.idempotencyKey !== "string" || !body.idempotencyKey) {
      res.status(400).json({ error: "Body field 'idempotencyKey' is required" });
      return;
    }
    if (body.confirmation !== true) {
      res.status(400).json({ error: "Body field 'confirmation' must be true" });
      return;
    }
    try {
      const result = removeMissingRecords(db, workspaceId, workspace.evidenceRoot, {
        evidenceItemIds: body.evidenceItemIds,
        idempotencyKey: body.idempotencyKey,
        exportBackup: body.exportBackup !== false, // default true, per spec ("enabled by default")
      });
      if (result.backup) result.backup = { ...result.backup, workspaceName: workspace.name };
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof MissingRecordsValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/missing-records/:operationId/undo", (req, res) => {
    const operationId = Number(req.params.operationId);
    if (!Number.isInteger(operationId)) {
      res.status(400).json({ error: "operationId must be an integer" });
      return;
    }
    try {
      const result = undoMissingRecordsRemoval(db, workspaceId, operationId);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof MissingRecordsOperationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
