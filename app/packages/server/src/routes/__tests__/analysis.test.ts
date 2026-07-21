import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";

const { extractTextFromItemMock } = vi.hoisted(() => ({ extractTextFromItemMock: vi.fn() }));
vi.mock("../../services/ocrService.js", () => ({ extractTextFromItem: extractTextFromItemMock, OcrError: class OcrError extends Error {} }));

import { createApp } from "../../app.js";
import { runMigrations } from "../../db/migrate.js";
import type { ResolvedWorkspace } from "../../config/workspaceConfig.js";
import type { AnalysisResultResponse } from "@trademark-evidence-assistant/shared";

describe("analysis routes", () => {
  const workspaceId = 1;
  let db: Database.Database;
  let workDir: string;
  let workspace: ResolvedWorkspace;

  beforeEach(() => {
    vi.clearAllMocks();
    extractTextFromItemMock.mockResolvedValue({ rawText: "", dateCandidates: [], orderNumberCandidates: [] });
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();
    workDir = mkdtempSync(join(tmpdir(), "analysis-route-test-"));
    const evidenceRoot = join(workDir, "evidence");
    mkdirSync(evidenceRoot, { recursive: true });
    workspace = { name: "Test", evidenceRoot, evidenceRootExists: true, databasePath: join(workDir, "generated", "app.db") };
  });

  afterEach(() => {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp(db, workspace, workspaceId);
  }

  function insertItem(id: string, filename: string) {
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256)
       VALUES (?, ?, ?, ?, 'jpg', 'image/jpeg', 100, 'sha-1')`,
    ).run(id, workspaceId, filename, filename);
    writeFileSync(join(workspace.evidenceRoot, filename), "content");
  }

  it("404s GET analysis before any run has happened", async () => {
    insertItem("item-1", "photo.jpg");
    const res = await request(buildApp()).get("/api/evidence-items/item-1/analysis");
    expect(res.status).toBe(404);
  });

  it("404s POST analysis for an unknown item", async () => {
    const res = await request(buildApp()).post("/api/evidence-items/does-not-exist/analysis");
    expect(res.status).toBe(404);
  });

  it("starts an analysis and then GET returns the same run", async () => {
    insertItem("item-2", "photo.jpg");
    const app = buildApp();
    const started = await request(app).post("/api/evidence-items/item-2/analysis");
    expect(started.status).toBe(200);
    const body = started.body as AnalysisResultResponse;
    expect(body.run.status).toBe("completed");

    const fetched = await request(app).get("/api/evidence-items/item-2/analysis");
    expect(fetched.status).toBe(200);
    expect((fetched.body as AnalysisResultResponse).run.id).toBe(body.run.id);
  });

  it("400s confirm without analysisRunId", async () => {
    insertItem("item-3", "photo.jpg");
    const res = await request(buildApp()).post("/api/evidence-items/item-3/analysis/confirm").send({ acceptedAnswers: [], rejectedSuggestionIds: [], acceptedConnectionSuggestionIds: [], rejectedConnectionSuggestionIds: [] });
    expect(res.status).toBe(400);
  });

  it("400s confirm with a malformed array field", async () => {
    insertItem("item-4", "photo.jpg");
    const res = await request(buildApp()).post("/api/evidence-items/item-4/analysis/confirm").send({ analysisRunId: 1, acceptedAnswers: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("confirms an accepted evidence-type suggestion end to end through the route", async () => {
    insertItem("item-5", "photo.jpg");
    const app = buildApp();
    const started = await request(app).post("/api/evidence-items/item-5/analysis");
    const body = started.body as AnalysisResultResponse;
    const typeSuggestion = body.evidenceTypeSuggestions[0];

    const confirmed = await request(app)
      .post("/api/evidence-items/item-5/analysis/confirm")
      .send({ analysisRunId: body.run.id, acceptedEvidenceTypeSuggestionId: typeSuggestion.id, acceptedAnswers: [], rejectedSuggestionIds: [], acceptedConnectionSuggestionIds: [], rejectedConnectionSuggestionIds: [] });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.acceptedEvidenceType).toBe(typeSuggestion.proposedValue);

    const item = await request(app).get("/api/evidence-items/item-5");
    expect(item.body.evidenceType?.typeId).toBe(typeSuggestion.proposedValue);
  });

  it("404s confirm for an unknown analysis run id", async () => {
    insertItem("item-6", "photo.jpg");
    const res = await request(buildApp())
      .post("/api/evidence-items/item-6/analysis/confirm")
      .send({ analysisRunId: 999999, acceptedAnswers: [], rejectedSuggestionIds: [], acceptedConnectionSuggestionIds: [], rejectedConnectionSuggestionIds: [] });
    expect(res.status).toBe(404);
  });
});
