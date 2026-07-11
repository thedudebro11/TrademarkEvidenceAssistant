import express, { type Express } from "express";
import type Database from "better-sqlite3";
import { createHealthRouter } from "./routes/health.js";
import { createScanRouter } from "./routes/scan.js";
import { createEvidenceItemsRouter } from "./routes/evidenceItems.js";
import { createExportRouter } from "./routes/export.js";
import { createBinderRouter } from "./routes/binder.js";
import type { ResolvedWorkspace } from "./config/workspaceConfig.js";

export function createApp(
  db: Database.Database,
  workspace: ResolvedWorkspace,
  workspaceId: number,
): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", createHealthRouter(db, workspace));
  app.use("/api", createScanRouter(db, workspaceId, workspace));
  app.use("/api", createEvidenceItemsRouter(db, workspaceId, workspace));
  app.use("/api", createExportRouter(db, workspaceId, workspace));
  app.use("/api", createBinderRouter(db, workspaceId, workspace.name));
  return app;
}
