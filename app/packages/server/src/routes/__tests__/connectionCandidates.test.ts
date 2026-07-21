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
import type { ConnectionCandidate } from "@trademark-evidence-assistant/shared";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("GET /api/evidence-items/candidates (Connections picker candidates)", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "connection-candidates-test-"));
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

  it("includes not-yet-reviewed items — evidence often relates to something you haven't gotten to yet", async () => {
    const app = buildApp();
    const progress = await request(app).get("/api/evidence-items/progress");
    expect(progress.body.unreviewed).toBeGreaterThan(0);

    const res = await request(app).get("/api/evidence-items/candidates?exclude=none");
    expect(res.status).toBe(200);
    const items = res.body as ConnectionCandidate[];
    expect(items.some((i) => i.reviewStatus === "unreviewed")).toBe(true);
    expect(items.length).toBe(progress.body.total);
  });

  it("includes items with any decided status too (include/maybe/follow-up/archive)", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/evidence-items/next");
    const second = await request(app).get("/api/evidence-items/next").query({ after: first.body.id });

    await request(app).post(`/api/evidence-items/${first.body.id}/decision`).send({ action: "include" });
    await request(app).post(`/api/evidence-items/${second.body.id}/decision`).send({ action: "follow_up" });

    const res = await request(app).get("/api/evidence-items/candidates?exclude=none");
    const ids = (res.body as ConnectionCandidate[]).map((i) => i.id);
    expect(ids).toContain(first.body.id);
    expect(ids).toContain(second.body.id);
  });

  it("excludes the item passed as 'exclude', regardless of its review status", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/evidence-items/next");

    const beforeDecision = await request(app).get(`/api/evidence-items/candidates?exclude=${first.body.id}`);
    expect((beforeDecision.body as ConnectionCandidate[]).map((i) => i.id)).not.toContain(first.body.id);

    await request(app).post(`/api/evidence-items/${first.body.id}/decision`).send({ action: "include" });
    const afterDecision = await request(app).get(`/api/evidence-items/candidates?exclude=${first.body.id}`);
    expect((afterDecision.body as ConnectionCandidate[]).map((i) => i.id)).not.toContain(first.body.id);
  });

  it("each candidate carries enough to identify, preview, and label it in a picker, not full item detail", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/evidence-items/candidates?exclude=none");
    const candidate = (res.body as ConnectionCandidate[])[0];
    expect(candidate.originalPath).toBeTruthy();
    expect(candidate.originalFilename).toBeTruthy();
    expect(candidate.reviewStatus).toBe("unreviewed");
    expect(candidate.inclusionDecision).toBeNull();
    expect(candidate).not.toHaveProperty("answers");
    expect(candidate).not.toHaveProperty("usefulness");
  });

  it("carries evidenceTypeId — null before classification, set once the item's evidence type is confirmed", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/evidence-items/next");

    const beforeClassification = await request(app).get("/api/evidence-items/candidates?exclude=none");
    const beforeCandidate = (beforeClassification.body as ConnectionCandidate[]).find((i) => i.id === first.body.id);
    expect(beforeCandidate?.evidenceTypeId).toBeNull();

    await request(app)
      .put(`/api/evidence-items/${first.body.id}/evidence-type`)
      .send({ typeId: "final_logo", source: "user", confidence: null, reason: null });

    const afterClassification = await request(app).get("/api/evidence-items/candidates?exclude=none");
    const afterCandidate = (afterClassification.body as ConnectionCandidate[]).find((i) => i.id === first.body.id);
    expect(afterCandidate?.evidenceTypeId).toBe("final_logo");
  });
});
