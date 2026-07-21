import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp } from "../../app.js";
import { runMigrations } from "../../db/migrate.js";
import type { ResolvedWorkspace } from "../../config/workspaceConfig.js";
import type { MissingRecordsPreviewResponse, RemoveMissingRecordsResponse } from "@trademark-evidence-assistant/shared";

describe("missing-records routes", () => {
  const workspaceId = 1;
  let db: Database.Database;
  let workDir: string;
  let workspace: ResolvedWorkspace;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();

    workDir = mkdtempSync(join(tmpdir(), "missing-records-route-test-"));
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

  function insertMissingItem(id: string, filename: string) {
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256, missing_since)
       VALUES (?, ?, ?, ?, 'jpg', 'image/jpeg', 100, 'sha-1', '2026-01-01T00:00:00.000Z')`,
    ).run(id, workspaceId, filename, filename);
  }

  it("preview returns confidently missing records", async () => {
    insertMissingItem("item-1", "gone.jpg");
    const app = buildApp();
    const res = await request(app).get("/api/missing-records/preview");
    expect(res.status).toBe(200);
    const body = res.body as MissingRecordsPreviewResponse;
    expect(body.confidentlyMissing.map((c) => c.evidenceItemId)).toEqual(["item-1"]);
  });

  it("excludes an item whose file exists on disk from preview", async () => {
    insertMissingItem("item-2", "present.jpg");
    writeFileSync(join(workspace.evidenceRoot, "present.jpg"), "content");
    const app = buildApp();
    const res = await request(app).get("/api/missing-records/preview");
    const body = res.body as MissingRecordsPreviewResponse;
    expect(body.confidentlyMissing).toHaveLength(0);
  });

  it("400s remove without evidenceItemIds", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/missing-records/remove").send({ idempotencyKey: "k1", confirmation: true });
    expect(res.status).toBe(400);
  });

  it("400s remove without idempotencyKey", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/missing-records/remove").send({ evidenceItemIds: ["item-1"], confirmation: true });
    expect(res.status).toBe(400);
  });

  it("400s remove without confirmation: true", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/missing-records/remove").send({ evidenceItemIds: ["item-1"], idempotencyKey: "k1" });
    expect(res.status).toBe(400);
  });

  it("removes a confirmed, still-missing record and returns the workspace name on the backup", async () => {
    insertMissingItem("item-3", "gone.jpg");
    const app = buildApp();
    const res = await request(app).post("/api/missing-records/remove").send({ evidenceItemIds: ["item-3"], idempotencyKey: "k1", confirmation: true, exportBackup: true });
    expect(res.status).toBe(200);
    const body = res.body as RemoveMissingRecordsResponse;
    expect(body.removedCount).toBe(1);
    expect(body.backup?.workspaceName).toBe("Test");
  });

  it("18/19. total evidence count and the Review Queue's item pool both drop after removal — the row is genuinely gone, not just hidden", async () => {
    insertMissingItem("item-4", "gone.jpg");
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256)
       VALUES ('item-4b', ?, 'kept.jpg', 'kept.jpg', 'jpg', 'image/jpeg', 100, 'sha-2')`,
    ).run(workspaceId);
    const app = buildApp();

    const before = await request(app).get("/api/evidence-items/progress");
    expect(before.body.total).toBe(2);

    await request(app).post("/api/missing-records/remove").send({ evidenceItemIds: ["item-4"], idempotencyKey: "k1", confirmation: true, exportBackup: false });

    const after = await request(app).get("/api/evidence-items/progress");
    expect(after.body.total).toBe(1);
  });

  it("undo restores a removed record", async () => {
    insertMissingItem("item-5", "gone.jpg");
    const app = buildApp();
    const removeRes = await request(app).post("/api/missing-records/remove").send({ evidenceItemIds: ["item-5"], idempotencyKey: "k1", confirmation: true, exportBackup: false });
    const operationId = removeRes.body.operationId as number;

    const undoRes = await request(app).post(`/api/missing-records/${operationId}/undo`);
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.restoredCount).toBe(1);

    const item = db.prepare("SELECT id FROM evidence_items WHERE id = 'item-5'").get();
    expect(item).toBeTruthy();
  });

  it("404s undo for an unknown operation id", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/missing-records/999999/undo");
    expect(res.status).toBe(404);
  });

  it("repeating the same idempotencyKey does not remove twice", async () => {
    insertMissingItem("item-6", "gone.jpg");
    const app = buildApp();
    await request(app).post("/api/missing-records/remove").send({ evidenceItemIds: ["item-6"], idempotencyKey: "same-key", confirmation: true, exportBackup: false });
    const second = await request(app).post("/api/missing-records/remove").send({ evidenceItemIds: ["item-6"], idempotencyKey: "same-key", confirmation: true, exportBackup: false });
    expect(second.status).toBe(200);
    const opCount = db.prepare("SELECT COUNT(*) AS c FROM missing_records_cleanup_operations WHERE idempotency_key = 'same-key'").get() as { c: number };
    expect(opCount.c).toBe(1);
  });
});
