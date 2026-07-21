import express, { type Express } from "express";
import type Database from "better-sqlite3";
import { createHealthRouter } from "./routes/health.js";
import { createScanRouter } from "./routes/scan.js";
import { createEvidenceItemsRouter } from "./routes/evidenceItems.js";
import { createExportRouter } from "./routes/export.js";
import { createBinderRouter } from "./routes/binder.js";
import { createBulkReviewRouter } from "./routes/bulkReview.js";
import { createHeicPreviewRouter } from "./routes/heicPreview.js";
import { createMissingRecordsRouter } from "./routes/missingRecords.js";
import { createAnalysisRouter } from "./routes/analysis.js";
import { createBatchAnalysisRouter } from "./routes/batchAnalysis.js";
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
  app.use("/api", createBulkReviewRouter(db, workspaceId));
  app.use("/api", createHeicPreviewRouter(db, workspaceId, workspace));
  app.use("/api", createMissingRecordsRouter(db, workspaceId, workspace));
  app.use("/api", createAnalysisRouter(db, workspaceId, workspace));
  app.use("/api", createBatchAnalysisRouter(db, workspaceId, workspace));
  return app;
}
