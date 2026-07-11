import { Router } from "express";
import type Database from "better-sqlite3";
import { runBinderGeneration, BinderValidationError } from "../services/binderService.js";
import { REPO_ROOT } from "../config/repoRoot.js";
import { join } from "node:path";

/** Thin route: delegates entirely to BinderService, per docs/ARCHITECTURE_CONSTITUTION.md #2. */
export function createBinderRouter(db: Database.Database, workspaceId: number, workspaceName: string): Router {
  const router = Router();

  router.post("/binder", async (req, res) => {
    const exportId = typeof req.body?.exportId === "number" ? req.body.exportId : null;
    try {
      const reportsRoot = join(REPO_ROOT, "reports");
      const summary = await runBinderGeneration(db, workspaceId, workspaceName, exportId, reportsRoot);
      res.status(200).json(summary);
    } catch (err) {
      if (err instanceof BinderValidationError) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
