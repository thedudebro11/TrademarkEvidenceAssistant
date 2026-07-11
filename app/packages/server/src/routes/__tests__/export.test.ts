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

describe("POST /api/export", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "export-route-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    await runScan(db, workspaceId, evidenceRoot);
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  it("runs an export and returns a summary even with nothing included yet", async () => {
    const workspace: ResolvedWorkspace = {
      name: "Golden",
      evidenceRoot,
      evidenceRootExists: true,
      databasePath: ":memory:",
    };
    const app = createApp(db, workspace, workspaceId);

    const res = await request(app).post("/api/export");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.itemsExported).toBe(0);
  });

  it("returns 409 when the evidence root does not exist", async () => {
    const workspace: ResolvedWorkspace = {
      name: "Golden",
      evidenceRoot: "/nonexistent",
      evidenceRootExists: false,
      databasePath: ":memory:",
    };
    const app = createApp(db, workspace, workspaceId);

    const res = await request(app).post("/api/export");
    expect(res.status).toBe(409);
  });
});
