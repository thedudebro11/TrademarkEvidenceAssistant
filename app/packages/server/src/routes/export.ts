import { Router } from "express";
import type Database from "better-sqlite3";
import { runExport } from "../services/exportService.js";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";
import { REPO_ROOT } from "../config/repoRoot.js";
import { join } from "node:path";

/**
 * Thin route: delegates entirely to ExportService, per
 * docs/ARCHITECTURE_CONSTITUTION.md #2.
 */
export function createExportRouter(db: Database.Database, workspaceId: number, workspace: ResolvedWorkspace): Router {
  const router = Router();

  router.post("/export", async (_req, res) => {
    if (!workspace.evidenceRootExists) {
      res.status(409).json({ error: `Evidence root does not exist: ${workspace.evidenceRoot}` });
      return;
    }
    try {
      const exportsRoot = join(REPO_ROOT, "exports");
      const summary = await runExport(db, workspaceId, workspace.name, workspace.evidenceRoot, exportsRoot);
      res.status(200).json(summary);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
