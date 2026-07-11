import { Router } from "express";
import type Database from "better-sqlite3";
import { runScan } from "../services/scanService.js";
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
      res.status(200).json(summary);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
