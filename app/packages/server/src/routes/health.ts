import { Router } from "express";
import type { HealthResponse } from "@trademark-evidence-assistant/shared";
import type Database from "better-sqlite3";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";

export function createHealthRouter(
  db: Database.Database,
  workspace: ResolvedWorkspace,
): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    let connected = false;
    try {
      db.prepare("SELECT 1").get();
      connected = true;
    } catch {
      connected = false;
    }

    const body: HealthResponse = {
      status: connected ? "ok" : "error",
      workspace: {
        name: workspace.name,
        evidenceRoot: workspace.evidenceRoot,
        evidenceRootExists: workspace.evidenceRootExists,
      },
      database: { connected },
    };

    res.status(connected ? 200 : 503).json(body);
  });

  return router;
}
