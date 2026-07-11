import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import request from "supertest";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../app.js";
import { runMigrations } from "../../db/migrate.js";
import { REPO_ROOT } from "../../config/repoRoot.js";
import type { ResolvedWorkspace } from "../../config/workspaceConfig.js";
import type { ScanSummary } from "@trademark-evidence-assistant/shared";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("POST /api/scan", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "scan-route-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  it("runs a scan and returns a summary", async () => {
    const workspace: ResolvedWorkspace = {
      name: "Golden",
      evidenceRoot,
      evidenceRootExists: true,
      databasePath: ":memory:",
    };
    const app = createApp(db, workspace, workspaceId);

    const res = await request(app).post("/api/scan");

    expect(res.status).toBe(200);
    const body = res.body as ScanSummary;
    expect(body.status).toBe("completed");
    expect(body.filesDiscovered).toBe(8);
    expect(body.itemsCreated).toBe(8);
  });

  it("returns 409 without touching the database when the evidence root does not exist", async () => {
    const workspace: ResolvedWorkspace = {
      name: "Golden",
      evidenceRoot: "/nonexistent/path",
      evidenceRootExists: false,
      databasePath: ":memory:",
    };
    const app = createApp(db, workspace, workspaceId);

    const res = await request(app).post("/api/scan");

    expect(res.status).toBe(409);
    const count = db.prepare("SELECT COUNT(*) AS c FROM scan_runs").get() as { c: number };
    expect(count.c).toBe(0);
  });
});
