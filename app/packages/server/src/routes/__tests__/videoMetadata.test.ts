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

describe("GET /api/evidence-items/:id/video-metadata", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "video-metadata-test-"));
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

  it("returns the default provider's honest 'unknown' shape for a real video file in the golden workspace", async () => {
    const app = buildApp();
    const progress = await request(app).get("/api/evidence-items/progress");
    // Walk the queue to find the golden workspace's .mp4 fixture.
    let current: string | null = null;
    let videoItemId: string | null = null;
    for (let i = 0; i < progress.body.total; i++) {
      const res = await request(app).get("/api/evidence-items/next").query(current ? { after: current } : {});
      if (res.status === 204) break;
      current = res.body.id;
      if (res.body.originalFilename.endsWith(".mp4")) {
        videoItemId = res.body.id;
        break;
      }
    }
    expect(videoItemId).toBeTruthy();

    const res = await request(app).get(`/api/evidence-items/${videoItemId}/video-metadata`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      durationSeconds: null,
      width: null,
      height: null,
      codec: null,
      fps: null,
      bitrateKbps: null,
      hasAudio: null,
    });
  });

  it("returns 404 for an evidence id that doesn't exist in this workspace", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/evidence-items/not-a-real-id/video-metadata");
    expect(res.status).toBe(404);
  });
});
