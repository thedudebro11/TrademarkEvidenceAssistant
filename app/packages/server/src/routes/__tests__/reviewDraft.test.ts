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
import type { EvidenceItemDetail, ReviewDraftPayload } from "@trademark-evidence-assistant/shared";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

function emptyDraft(overrides: Partial<ReviewDraftPayload> = {}): ReviewDraftPayload {
  return {
    evidenceType: null,
    interviewAnswers: {},
    connectionsToAdd: [],
    connectionIdsToRemove: [],
    noRelatedEvidence: false,
    usefulnessOverride: { action: "none", score: null, band: null, note: null },
    notes: "",
    decisionAction: null,
    ...overrides,
  };
}

describe("PUT /api/evidence-items/:id/draft (atomic Review Draft save)", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "review-draft-route-test-"));
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

  it("persists evidence type, interview answers, notes, and a decision together in one call", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/draft`)
      .send(
        emptyDraft({
          evidenceType: { typeId: "final_logo", source: "user", confidence: null, reason: null },
          interviewAnswers: { final_logo_official: { value: "yes", confidence: "high", note: null } },
          notes: "Looks like the current logo.",
          decisionAction: "include",
        }),
      );

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.evidenceType?.typeId).toBe("final_logo");
    expect(item.answers.find((a) => a.questionId === "final_logo_official")?.value).toBe("yes");
    expect(item.notes).toBe("Looks like the current logo.");
    expect(item.reviewStatus).toBe("reviewed");
    expect(item.inclusionDecision).toBe("include");
  });

  it("decisionAction null leaves review status untouched ('Save & Next' without deciding)", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/draft`)
      .send(emptyDraft({ notes: "Just parking a note for now." }));

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.reviewStatus).toBe("unreviewed");
    expect(item.notes).toBe("Just parking a note for now.");
  });

  it("adds and removes connections in the same save", async () => {
    const app = buildApp();
    const progress = await request(app).get("/api/evidence-items/progress");
    const first = await request(app).get("/api/evidence-items/next");
    const second = await request(app).get("/api/evidence-items/next").query({ after: first.body.id });
    expect(progress.body.total).toBeGreaterThan(1);

    const res = await request(app)
      .put(`/api/evidence-items/${first.body.id}/draft`)
      .send(
        emptyDraft({
          connectionsToAdd: [
            { targetPath: second.body.originalPath, type: "related_to", explanation: "Same shoot.", confidence: "medium" },
          ],
        }),
      );

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.connections.length).toBe(1);

    const connectionId = item.connections[0].connectionId;
    const removeRes = await request(app)
      .put(`/api/evidence-items/${first.body.id}/draft`)
      .send(emptyDraft({ connectionIdsToRemove: [connectionId] }));

    expect(removeRes.status).toBe(200);
    expect((removeRes.body as EvidenceItemDetail).connections.length).toBe(0);
  });

  it("is atomic — an invalid evidence type rolls back the entire save, including the notes in the same payload", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/draft`)
      .send(
        emptyDraft({
          evidenceType: { typeId: "not_a_real_type", source: "user", confidence: null, reason: null },
          notes: "This should never be saved because the type above is invalid.",
        }),
      );

    expect(res.status).toBe(400);

    const after = await request(app).get(`/api/evidence-items/${itemId}`);
    expect((after.body as EvidenceItemDetail).notes).toBeNull();
    expect((after.body as EvidenceItemDetail).evidenceType).toBeNull();
  });

  it("is atomic — an invalid connection removal rolls back a valid usefulness override in the same payload", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/draft`)
      .send(
        emptyDraft({
          usefulnessOverride: { action: "set", score: 90, band: "Strong", note: "Verified in person." },
          connectionIdsToRemove: [999999],
        }),
      );

    expect(res.status).toBe(400);

    const after = await request(app).get(`/api/evidence-items/${itemId}`);
    expect((after.body as EvidenceItemDetail).usefulness.override).toBeNull();
  });

  it("rejects a malformed payload with 400 rather than a 500", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const res = await request(app)
      .put(`/api/evidence-items/${next.body.id}/draft`)
      .send({ notes: 42 });
    expect(res.status).toBe(400);
  });
});
