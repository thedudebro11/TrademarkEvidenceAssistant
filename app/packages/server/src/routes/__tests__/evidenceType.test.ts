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
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("evidence type routes (Phase 3.5)", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Golden', 'unused')").run();

    evidenceRoot = mkdtempSync(join(tmpdir(), "evidence-type-route-test-"));
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

  it("GET .../evidence-type-suggestion returns a deterministic, explained suggestion", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app).get(`/api/evidence-items/${itemId}/evidence-type-suggestion`);
    expect(res.status).toBe(200);
    expect(typeof res.body.typeId).toBe("string");
    expect(["low", "medium", "high"]).toContain(res.body.confidence);
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(res.body.reasons.length).toBeGreaterThan(0);
  });

  it("a freshly-scanned item has no confirmed evidenceType but does have a suggestion in its detail", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const item = next.body as EvidenceItemDetail;
    expect(item.evidenceType).toBeNull();
    expect(item.evidenceTypeSuggestion).not.toBeNull();
  });

  it("PUT .../evidence-type confirms a type, freezes the registry version, and bridges the legacy file role", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/evidence-type`)
      .send({ typeId: "final_logo", source: "user", confidence: null, reason: null });

    expect(res.status).toBe(200);
    const item = res.body as EvidenceItemDetail;
    expect(item.evidenceType?.typeId).toBe("final_logo");
    expect(item.evidenceType?.registryVersion).toBe("1.0");
    expect(item.evidenceType?.source).toBe("user");
    // final_logo's legacyFileRole is "logo_export" — confirming the type
    // should also set the legacy field so Phase 6 scoring keeps working.
    expect(item.fileRole).toBe("logo_export");
    // Once confirmed, the detail response stops computing a fresh suggestion.
    expect(item.evidenceTypeSuggestion).toBeNull();
  });

  it("PUT .../evidence-type rejects an unknown type id", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/evidence-type`)
      .send({ typeId: "not_a_real_type", source: "user" });
    expect(res.status).toBe(400);
  });

  it("PUT .../evidence-type-answers/:questionId saves an answer belonging to the confirmed type's interview", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    await request(app)
      .put(`/api/evidence-items/${itemId}/evidence-type`)
      .send({ typeId: "final_logo", source: "user" });

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/evidence-type-answers/final_logo_official`)
      .send({ value: "yes", confidence: "high", note: null });

    expect(res.status).toBe(200);
    expect(res.body.value).toBe("yes");
  });

  it("PUT .../evidence-type-answers/:questionId rejects a question that isn't part of the confirmed type's interview", async () => {
    const app = buildApp();
    const next = await request(app).get("/api/evidence-items/next");
    const itemId = next.body.id as string;

    await request(app)
      .put(`/api/evidence-items/${itemId}/evidence-type`)
      .send({ typeId: "final_logo", source: "user" });

    const res = await request(app)
      .put(`/api/evidence-items/${itemId}/evidence-type-answers/printful_invoice_order_number`)
      .send({ value: "12345" });

    expect(res.status).toBe(400);
  });
});
