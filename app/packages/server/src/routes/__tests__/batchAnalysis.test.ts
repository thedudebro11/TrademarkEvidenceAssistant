import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";

const { extractTextFromItemMock } = vi.hoisted(() => ({ extractTextFromItemMock: vi.fn() }));
vi.mock("../../services/ocrService.js", () => ({ extractTextFromItem: extractTextFromItemMock, OcrError: class OcrError extends Error {} }));

import { createApp } from "../../app.js";
import { runMigrations } from "../../db/migrate.js";
import type { ResolvedWorkspace } from "../../config/workspaceConfig.js";
import type { BatchAnalysisJobStatus, SuggestionQueueResponse } from "@trademark-evidence-assistant/shared";

describe("batch analysis routes", () => {
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
    workDir = mkdtempSync(join(tmpdir(), "batch-analysis-route-test-"));
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
    const abs = join(workspace.evidenceRoot, filename);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "content");
  }

  async function waitForJobDone(app: ReturnType<typeof buildApp>, jobId: number, maxIterations = 100): Promise<BatchAnalysisJobStatus> {
    for (let i = 0; i < maxIterations; i++) {
      const res = await request(app).get(`/api/analysis/batch/${jobId}`);
      const job = res.body as BatchAnalysisJobStatus;
      if (job.status !== "running" && job.status !== "queued") return job;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("job did not finish in time");
  }

  it("400s a batch start with an invalid selectionMode", async () => {
    const res = await request(buildApp()).post("/api/analysis/batch").send({ selectionMode: "not-a-real-mode" });
    expect(res.status).toBe(400);
  });

  it("400s a batch start missing itemIds for selected_ids", async () => {
    const res = await request(buildApp()).post("/api/analysis/batch").send({ selectionMode: "selected_ids" });
    expect(res.status).toBe(400);
  });

  it("starts a batch job (202) and the job status reaches a terminal state via polling", async () => {
    insertItem("item-1", "photo.jpg");
    const app = buildApp();
    const started = await request(app).post("/api/analysis/batch").send({ selectionMode: "selected_ids", itemIds: ["item-1"] });
    expect(started.status).toBe(202);
    expect(typeof started.body.jobId).toBe("number");

    const job = await waitForJobDone(app, started.body.jobId);
    expect(job.status).toBe("completed");
    expect(job.readyForReview).toBe(true);
    expect(job.totalCount).toBe(1);
    expect(job.succeededCount).toBe(1);
  });

  it("404s a status request for an unknown job id", async () => {
    const res = await request(buildApp()).get("/api/analysis/batch/999999");
    expect(res.status).toBe(404);
  });

  it("cancels a running job via POST .../cancel", async () => {
    insertItem("item-2", "photo2.jpg");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    extractTextFromItemMock.mockImplementation(async () => {
      await gate;
      return { rawText: "", dateCandidates: [], orderNumberCandidates: [] };
    });
    const app = buildApp();
    const started = await request(app).post("/api/analysis/batch").send({ selectionMode: "selected_ids", itemIds: ["item-2"] });
    const cancel = await request(app).post(`/api/analysis/batch/${started.body.jobId}/cancel`);
    expect(cancel.status).toBe(202);
    release();
    await waitForJobDone(app, started.body.jobId);
  });

  it("404s cancelling an unknown job", async () => {
    const res = await request(buildApp()).post("/api/analysis/batch/999999/cancel");
    expect(res.status).toBe(404);
  });

  it("previews a selection without starting a job", async () => {
    insertItem("item-3", "Customer Photos/photo3.jpg");
    const res = await request(buildApp()).post("/api/analysis/batch/preview").send({ selectionMode: "selected_ids", itemIds: ["item-3"] });
    expect(res.status).toBe(200);
    expect(res.body.eligibleCount).toBe(1);
  });

  it("returns the suggestions queue after a batch job completes", async () => {
    insertItem("item-4", "Customer Photos/photo4.jpg");
    const app = buildApp();
    const started = await request(app).post("/api/analysis/batch").send({ selectionMode: "selected_ids", itemIds: ["item-4"] });
    await waitForJobDone(app, started.body.jobId);

    const queueRes = await request(app).get("/api/analysis/suggestions-queue");
    expect(queueRes.status).toBe(200);
    const body = queueRes.body as SuggestionQueueResponse;
    expect(body.items.some((i) => i.evidenceItemId === "item-4")).toBe(true);
  });

  it("400s an invalid minConfidence filter on the suggestions queue", async () => {
    const res = await request(buildApp()).get("/api/analysis/suggestions-queue?minConfidence=extreme");
    expect(res.status).toBe(400);
  });

  it("scopes the suggestions queue to a jobId when given", async () => {
    insertItem("item-5", "Customer Photos/photo5.jpg");
    insertItem("item-6", "Customer Photos/photo6.jpg");
    const app = buildApp();
    const firstJob = await request(app).post("/api/analysis/batch").send({ selectionMode: "selected_ids", itemIds: ["item-5"] });
    await waitForJobDone(app, firstJob.body.jobId);
    const secondJob = await request(app).post("/api/analysis/batch").send({ selectionMode: "selected_ids", itemIds: ["item-6"] });
    await waitForJobDone(app, secondJob.body.jobId);

    const scoped = await request(app).get(`/api/analysis/suggestions-queue?jobId=${firstJob.body.jobId}`);
    const body = scoped.body as SuggestionQueueResponse;
    expect(body.items.map((i) => i.evidenceItemId)).toEqual(["item-5"]);
  });
});
