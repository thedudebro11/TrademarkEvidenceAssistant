import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import request from "supertest";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../app.js";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../../services/scanService.js";
import { REPO_ROOT } from "../../config/repoRoot.js";
import type { ResolvedWorkspace } from "../../config/workspaceConfig.js";
import type { EvidenceItemDetail, ReviewProgress } from "@trademark-evidence-assistant/shared";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("evidence items routes", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "evidence-items-route-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    await runScan(db, workspaceId, evidenceRoot);
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  function buildApp() {
    const workspace: ResolvedWorkspace = {
      name: "Golden",
      evidenceRoot,
      evidenceRootExists: true,
      databasePath: ":memory:",
    };
    return createApp(db, workspace, workspaceId);
  }

  it("GET /api/evidence-items/progress reports counts", async () => {
    const res = await request(buildApp()).get("/api/evidence-items/progress");
    expect(res.status).toBe(200);
    const body = res.body as ReviewProgress;
    expect(body.total).toBe(8);
    expect(body.unreviewed).toBe(8);
  });

  it("GET /api/evidence-items/next returns the first item, then advances after a decision", async () => {
    const app = buildApp();

    const first = await request(app).get("/api/evidence-items/next");
    expect(first.status).toBe(200);
    const firstItem = first.body as EvidenceItemDetail;

    await request(app).post(`/api/evidence-items/${firstItem.id}/decision`).send({ action: "include" });

    const second = await request(app).get("/api/evidence-items/next").query({ after: firstItem.id });
    expect(second.status).toBe(200);
    expect(second.body.id).not.toBe(firstItem.id);
  });

  it("GET /api/evidence-items/next returns 204 once the queue is exhausted", async () => {
    const app = buildApp();
    const all = await request(app).get("/api/evidence-items/progress");
    let currentId: string | null = null;
    for (let i = 0; i < all.body.total; i++) {
      const res = await request(app).get("/api/evidence-items/next").query(currentId ? { after: currentId } : {});
      currentId = res.body.id;
      await request(app).post(`/api/evidence-items/${currentId}/decision`).send({ action: "include" });
    }
    const exhausted = await request(app).get("/api/evidence-items/next").query({ after: currentId! });
    expect(exhausted.status).toBe(204);
  });

  it("POST /api/evidence-items/:id/decision rejects an invalid action", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const res = await request(app)
      .post(`/api/evidence-items/${next.body.id}/decision`)
      .send({ action: "definitely_not_valid" });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/evidence-items/:id/notes autosaves free text", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");

    const res = await request(app)
      .patch(`/api/evidence-items/${next.body.id}/notes`)
      .send({ notes: "This appears to be the primary product shot." });
    expect(res.status).toBe(200);
    expect(res.body.notesUpdatedAt).toBeTruthy();

    const detail = await request(app).get(`/api/evidence-items/${next.body.id}`);
    expect(detail.body.notes).toBe("This appears to be the primary product shot.");
  });

  it("GET /api/evidence-items/:id/file streams the real file bytes with correct content-type", async () => {
    const app = buildApp();
    const items = await request(app).get("/api/evidence-items/progress");
    expect(items.body.total).toBe(8);

    const next = await request(app).get("/api/evidence-items/next");
    const res = await request(app).get(`/api/evidence-items/${next.body.id}/file`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe(next.body.mimeType);
  });

  it("GET /api/evidence-items/:id/file returns 404 for an unknown id", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/evidence-items/not-a-real-id/file");
    expect(res.status).toBe(404);
  });

  it("GET /api/evidence-items/:id returns 404 for an unknown id", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/evidence-items/not-a-real-id");
    expect(res.status).toBe(404);
  });

  it("PATCH /api/evidence-items/:id/role sets a valid role", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const res = await request(app).patch(`/api/evidence-items/${next.body.id}/role`).send({ role: "product_photo" });
    expect(res.status).toBe(200);
    expect(res.body.fileRole).toBe("product_photo");
  });

  it("PATCH /api/evidence-items/:id/role rejects an invalid role", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const res = await request(app).patch(`/api/evidence-items/${next.body.id}/role`).send({ role: "spaceship" });
    expect(res.status).toBe(400);
  });

  it("PUT /api/evidence-items/:id/answers/:questionId saves an answer and changes the question set when role changes", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const id = next.body.id;

    const saved = await request(app)
      .put(`/api/evidence-items/${id}/answers/universal_what_is_this`)
      .send({ value: "A product photo", confidence: "high", note: null });
    expect(saved.status).toBe(200);
    expect(saved.body.value).toBe("A product photo");

    const detail = await request(app).get(`/api/evidence-items/${id}`);
    expect(detail.body.answers).toHaveLength(1);
    expect(detail.body.answers[0].questionId).toBe("universal_what_is_this");
  });

  it("PUT /api/evidence-items/:id/answers/:questionId rejects a non-string value", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const res = await request(app)
      .put(`/api/evidence-items/${next.body.id}/answers/universal_what_is_this`)
      .send({ value: 12345 });
    expect(res.status).toBe(400);
  });
});
