import { Router } from "express";
import { createReadStream, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import {
  ensureHeicPreview,
  getHeicBackfillJobStatus,
  getHeicPreviewInfo,
  HeicPreviewItemNotFoundError,
  HeicPreviewUnknownDecoderError,
  resolveReadyHeicPreviewFile,
  runHeicPreviewBackfill,
  type HeicPreviewPaths,
} from "../services/heicPreviewService.js";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";

/**
 * Thin routes only — all HEIC preview logic lives in
 * heicPreviewService.ts, per docs/ARCHITECTURE_CONSTITUTION.md #2.
 * Every path here is resolved server-side from a validated evidence
 * item id (or, for backfill, the workspace's own evidence root) — no
 * route ever accepts a client-supplied filesystem path.
 */
export function createHeicPreviewRouter(db: Database.Database, workspaceId: number, workspace: ResolvedWorkspace): Router {
  const router = Router();
  const paths: HeicPreviewPaths = {
    evidenceRoot: workspace.evidenceRoot,
    generatedRoot: join(dirname(workspace.databasePath), "heic-previews"),
  };

  router.get("/evidence-items/:id/heic-preview/status", (req, res) => {
    const info = getHeicPreviewInfo(db, workspaceId, req.params.id);
    if (!info) {
      res.status(404).json({ error: "No HEIC/HEIF evidence item found with this id" });
      return;
    }
    res.status(200).json(info);
  });

  router.post("/evidence-items/:id/heic-preview/generate", async (req, res) => {
    const body = (req.body ?? {}) as { decoderId?: unknown; force?: unknown };
    const decoderId = typeof body.decoderId === "string" ? body.decoderId : undefined;
    const force = body.force === true;
    try {
      const info = await ensureHeicPreview(db, workspaceId, req.params.id, paths, { decoderId, force });
      res.status(200).json(info);
    } catch (err) {
      if (err instanceof HeicPreviewItemNotFoundError) {
        res.status(404).json({ error: "No HEIC/HEIF evidence item found with this id" });
        return;
      }
      if (err instanceof HeicPreviewUnknownDecoderError) {
        res.status(400).json({ error: "Unknown HEIC decoder id" });
        return;
      }
      res.status(500).json({ error: "HEIC preview generation could not be started" });
    }
  });

  router.get("/evidence-items/:id/heic-preview/file", (req, res) => {
    const resolved = resolveReadyHeicPreviewFile(db, workspaceId, req.params.id, paths.generatedRoot);
    if (!resolved) {
      res.status(404).json({ error: "No ready HEIC preview is available for this item" });
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
          res.status(500).json({ error: "The generated preview could not be opened" });
        }
      });
      stream.pipe(res);
    } catch {
      res.status(500).json({ error: "The generated preview could not be opened" });
    }
  });

  router.post("/heic-previews/backfill", async (_req, res) => {
    try {
      const jobId = await runHeicPreviewBackfill(db, workspaceId, paths);
      res.status(202).json({ jobId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Could not start the backfill job" });
    }
  });

  router.get("/heic-previews/backfill/:jobId", (req, res) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId)) {
      res.status(400).json({ error: "jobId must be an integer" });
      return;
    }
    const status = getHeicBackfillJobStatus(db, workspaceId, jobId);
    if (!status) {
      res.status(404).json({ error: "Backfill job not found" });
      return;
    }
    res.status(200).json(status);
  });

  return router;
}
