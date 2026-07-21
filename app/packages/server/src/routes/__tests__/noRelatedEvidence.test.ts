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

describe("'No Related Evidence' workflow", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "no-related-evidence-test-"));
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

  it("test 1 — checking 'No related evidence' via the draft save records the reviewed state", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/draft`)
      .send(emptyDraft({ noRelatedEvidence: true }));

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.noRelatedEvidence).toBe(true);
    expect(item.connections).toEqual([]);
  });

  it("test 2 — checking it creates no database connection rows", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    await request(app).put(`/api/evidence-items/${itemId}/draft`).send(emptyDraft({ noRelatedEvidence: true }));

    const count = db.prepare("SELECT COUNT(*) AS c FROM connections").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("this is distinct from never having reviewed the section — false is the untouched default, true is an explicit determination", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const item = next.body as EvidenceItemDetail;
    expect(item.noRelatedEvidence).toBe(false);
  });

  it("test 4 — adding a connection automatically clears a previously-set 'no related evidence' flag, for both items involved", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/evidence-items/next");
    const second = await request(app).get("/api/evidence-items/next").query({ after: first.body.id });

    // Both items explicitly reviewed as "no related evidence".
    await request(app).put(`/api/evidence-items/${first.body.id}/draft`).send(emptyDraft({ noRelatedEvidence: true }));
    await request(app).put(`/api/evidence-items/${second.body.id}/draft`).send(emptyDraft({ noRelatedEvidence: true }));

    // Now link them.
    const res = await request(app)
      .put(`/api/evidence-items/${first.body.id}/draft`)
      .send(
        emptyDraft({
          connectionsToAdd: [{ targetPath: second.body.originalPath, type: "related_to", explanation: "Same batch.", confidence: null }],
        }),
      );
    expect(res.status).toBe(200);
    expect((res.body as EvidenceItemDetail).noRelatedEvidence).toBe(false);

    // The target item's flag is cleared too, even though its own draft save didn't touch connections.
    const secondAfter = await request(app).get(`/api/evidence-items/${second.body.id}`);
    expect((secondAfter.body as EvidenceItemDetail).noRelatedEvidence).toBe(false);
    expect((secondAfter.body as EvidenceItemDetail).connections.length).toBe(1);
  });

  it("a contradictory payload (noRelatedEvidence: true alongside a real connection add) resolves in favor of the connection — the flag is not set", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/evidence-items/next");
    const second = await request(app).get("/api/evidence-items/next").query({ after: first.body.id });

    const res = await request(app)
      .put(`/api/evidence-items/${first.body.id}/draft`)
      .send(
        emptyDraft({
          noRelatedEvidence: true,
          connectionsToAdd: [{ targetPath: second.body.originalPath, type: "related_to", explanation: "e", confidence: null }],
        }),
      );

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.connections.length).toBe(1);
    expect(item.noRelatedEvidence).toBe(false);
  });

  it("test 6 — Save & Next (a decision) persists the reviewed-with-zero-connections state together with the decision", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/draft`)
      .send(emptyDraft({ noRelatedEvidence: true, decisionAction: "include" }));

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.noRelatedEvidence).toBe(true);
    expect(item.reviewStatus).toBe("reviewed");
    expect(item.inclusionDecision).toBe("include");
  });

  it("test 7 — an item that already has connections (pre-existing, from a real connection-creation flow) reports noRelatedEvidence false without any special migration handling", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/evidence-items/next");
    const second = await request(app).get("/api/evidence-items/next").query({ after: first.body.id });

    await request(app)
      .put(`/api/evidence-items/${first.body.id}/draft`)
      .send(
        emptyDraft({
          connectionsToAdd: [{ targetPath: second.body.originalPath, type: "related_to", explanation: "e", confidence: null }],
        }),
      );

    // Fetch as if this were a pre-existing row from before this feature existed —
    // the no_related_evidence column defaults to 0 for every row already, so no backfill is needed.
    const after = await request(app).get(`/api/evidence-items/${first.body.id}`);
    const item = after.body as EvidenceItemDetail;
    expect(item.connections.length).toBe(1);
    expect(item.noRelatedEvidence).toBe(false);
  });

  it("attempting to set noRelatedEvidence directly is ignored (not an error) when the item already has connections — the invariant is enforced authoritatively, not just by the UI", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/evidence-items/next");
    const second = await request(app).get("/api/evidence-items/next").query({ after: first.body.id });

    await request(app)
      .put(`/api/evidence-items/${first.body.id}/draft`)
      .send(
        emptyDraft({
          connectionsToAdd: [{ targetPath: second.body.originalPath, type: "related_to", explanation: "e", confidence: null }],
        }),
      );

    const res = await request(app)
      .put(`/api/evidence-items/${first.body.id}/draft`)
      .send(emptyDraft({ noRelatedEvidence: true }));

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.connections.length).toBe(1);
    expect(item.noRelatedEvidence).toBe(false);
  });
});
