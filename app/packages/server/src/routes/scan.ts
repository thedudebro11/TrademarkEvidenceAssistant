import { Router } from "express";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import { runScan } from "../services/scanService.js";
import { runHeicPreviewBackfill } from "../services/heicPreviewService.js";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";

/**
 * Thin route: validates nothing itself beyond HTTP concerns and
 * delegates entirely to ScanService, per
 * docs/ARCHITECTURE_CONSTITUTION.md #2 ("Never allow Express routes to
 * contain business logic").
 */
export function createScanRouter(db: Database.Database, workspaceId: number, workspace: ResolvedWorkspace): Router {
  const router = Router();

  router.post("/scan", async (_req, res) => {
    if (!workspace.evidenceRootExists) {
      res.status(409).json({
        error: `Evidence root does not exist: ${workspace.evidenceRoot}`,
      });
      return;
    }

    try {
      const summary = await runScan(db, workspaceId, workspace.evidenceRoot);
      // Fire-and-forget: enqueues missing/stale HEIC previews without
      // making the scan response wait for any image conversion to
      // finish (docs/ADR_0005_HEIC_PREVIEWS.md — "file-discovery scan
      // should not block until every image conversion finishes").
      // Idempotent — items with an already-ready, fingerprint-matching
      // preview are skipped, so calling this after every scan is safe.
      void runHeicPreviewBackfill(db, workspaceId, {
        evidenceRoot: workspace.evidenceRoot,
        generatedRoot: join(dirname(workspace.databasePath), "heic-previews"),
      }).catch(() => {});
      res.status(200).json(summary);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
