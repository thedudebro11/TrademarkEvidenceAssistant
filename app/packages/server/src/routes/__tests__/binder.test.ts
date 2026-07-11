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

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("POST /api/binder", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "binder-route-test-"));
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

  it("returns 409 with a clear message when no export has been run yet", async () => {
    const res = await request(buildApp()).post("/api/binder");
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Generate an evidence package first");
  });

  it("generates a binder after a real export has completed", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    await request(app).post(`/api/evidence-items/${next.body.id}/decision`).send({ action: "include" });
    await request(app).post("/api/export");

    const res = await request(app).post("/api/binder");
    expect(res.status).toBe(200);
    expect(res.body.itemCount).toBe(1);
    expect(res.body.outputPaths.markdown).toBeTruthy();
  });
});
