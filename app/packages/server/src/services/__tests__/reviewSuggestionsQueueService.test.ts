import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrate.js";

const { extractTextFromItemMock } = vi.hoisted(() => ({ extractTextFromItemMock: vi.fn() }));
vi.mock("../ocrService.js", () => ({ extractTextFromItem: extractTextFromItemMock, OcrError: class OcrError extends Error {} }));

import { startAnalysis } from "../analysisService.js";
import { getSuggestionQueue } from "../reviewSuggestionsQueueService.js";

function ocrExtraction(rawText = "") {
  return { rawText, dateCandidates: [], orderNumberCandidates: [] };
}

describe("reviewSuggestionsQueueService", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    extractTextFromItemMock.mockResolvedValue(ocrExtraction());
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();
    evidenceRoot = mkdtempSync(join(tmpdir(), "review-queue-test-"));
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  function insertItem(id: string, relativePath: string) {
    const abs = join(evidenceRoot, relativePath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "content");
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256)
       VALUES (?, ?, ?, ?, ?, 'image/jpeg', 100, ?)`,
    ).run(id, workspaceId, relativePath, relativePath.split("/").pop(), relativePath.split(".").pop(), `sha-${id}`);
  }

  it("includes an item with a still-actionable (proposed) evidence-type suggestion", async () => {
    insertItem("q1", "Customer Photos/q1.jpg");
    await startAnalysis(db, workspaceId, "q1", { evidenceRoot });
    const queue = getSuggestionQueue(db, workspaceId, {});
    expect(queue.items.some((i) => i.evidenceItemId === "q1")).toBe(true);
  });

  it("excludes an item with no actionable suggestions at all (nothing to review)", async () => {
    insertItem("q2", "Misc/q2.jpg"); // no strong folder/OCR signal at all → still gets a 'miscellaneous' type suggestion, which IS actionable
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction(""));
    await startAnalysis(db, workspaceId, "q2", { evidenceRoot });
    // Even a low-signal item gets a proposed evidence-type suggestion, so it correctly still appears — this test instead verifies a fully rejected run disappears from the queue.
    const runRow = db.prepare("SELECT id FROM analysis_runs WHERE evidence_item_id = 'q2'").get() as { id: number };
    db.prepare("UPDATE evidence_suggestions SET state = 'rejected' WHERE analysis_run_id = ?").run(runRow.id);
    const queue = getSuggestionQueue(db, workspaceId, {});
    expect(queue.items.some((i) => i.evidenceItemId === "q2")).toBe(false);
  });

  it("filters by folder", async () => {
    insertItem("qf1", "Customer Photos/qf1.jpg");
    insertItem("qf2", "Printful Orders/qf2.png");
    await startAnalysis(db, workspaceId, "qf1", { evidenceRoot });
    await startAnalysis(db, workspaceId, "qf2", { evidenceRoot });
    const queue = getSuggestionQueue(db, workspaceId, { folder: "Customer Photos" });
    expect(queue.items.map((i) => i.evidenceItemId)).toEqual(["qf1"]);
  });

  it("filters by suggested evidence type", async () => {
    insertItem("qt1", "Customer Photos/qt1.jpg");
    insertItem("qt2", "Product Photos/qt2.jpg");
    await startAnalysis(db, workspaceId, "qt1", { evidenceRoot });
    await startAnalysis(db, workspaceId, "qt2", { evidenceRoot });
    const queue = getSuggestionQueue(db, workspaceId, { evidenceType: "customer_photo" });
    expect(queue.items.every((i) => i.suggestedEvidenceType === "customer_photo")).toBe(true);
    expect(queue.items.some((i) => i.evidenceItemId === "qt1")).toBe(true);
    expect(queue.items.some((i) => i.evidenceItemId === "qt2")).toBe(false);
  });

  it("filters by minimum confidence", async () => {
    insertItem("qc1", "Printful Orders/qc1.png");
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction("Order #PF445566778 Order Status: Fulfilled Shipping Address: 42 Wallaby Way"));
    await startAnalysis(db, workspaceId, "qc1", { evidenceRoot }); // high confidence, OCR-derived

    insertItem("qc2", "Product Photos/qc2.jpg");
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction(""));
    await startAnalysis(db, workspaceId, "qc2", { evidenceRoot }); // low confidence, folder-only

    const highOnly = getSuggestionQueue(db, workspaceId, { minConfidence: "high" });
    expect(highOnly.items.some((i) => i.evidenceItemId === "qc1")).toBe(true);
    expect(highOnly.items.some((i) => i.evidenceItemId === "qc2")).toBe(false);
  });

  it("filters by unresolved customer status", async () => {
    insertItem("qu1", "Customer Photos/qu1.jpg");
    insertItem("qu2", "Printful Orders/qu2.png");
    await startAnalysis(db, workspaceId, "qu1", { evidenceRoot });
    await startAnalysis(db, workspaceId, "qu2", { evidenceRoot });
    const queue = getSuggestionQueue(db, workspaceId, { unresolvedCustomerStatus: true });
    expect(queue.items.some((i) => i.evidenceItemId === "qu1")).toBe(true);
    expect(queue.items.some((i) => i.evidenceItemId === "qu2")).toBe(false);
  });

  it("filters by contradiction (a date conflict)", async () => {
    insertItem("qd1", "Printful Orders/qd1.png");
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction("Order Date: March 1, 2020. Delivered March 5, 2024."));
    await startAnalysis(db, workspaceId, "qd1", { evidenceRoot });
    insertItem("qd2", "Printful Orders/qd2.png");
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction(""));
    await startAnalysis(db, workspaceId, "qd2", { evidenceRoot });

    const queue = getSuggestionQueue(db, workspaceId, { hasContradiction: true });
    expect(queue.items.some((i) => i.evidenceItemId === "qd1")).toBe(true);
    expect(queue.items.some((i) => i.evidenceItemId === "qd2")).toBe(false);
  });

  it("filters by connection suggestions present", async () => {
    insertItem("qx1", "Printful Orders/qx1.png");
    insertItem("qx2", "Printful Orders/qx2.png");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order #PF998877665"));
    await startAnalysis(db, workspaceId, "qx1", { evidenceRoot });
    await startAnalysis(db, workspaceId, "qx2", { evidenceRoot });

    insertItem("qx3", "Printful Orders/qx3.png");
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction("no identifiers here"));
    await startAnalysis(db, workspaceId, "qx3", { evidenceRoot });

    const queue = getSuggestionQueue(db, workspaceId, { hasConnections: true });
    expect(queue.items.some((i) => i.evidenceItemId === "qx1")).toBe(true);
    expect(queue.items.some((i) => i.evidenceItemId === "qx3")).toBe(false);
  });

  it("filters by failed extraction (nothing useful found)", async () => {
    insertItem("qe1", "Misc/qe1.jpg");
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction(""));
    await startAnalysis(db, workspaceId, "qe1", { evidenceRoot });

    insertItem("qe2", "Printful Orders/qe2.png");
    extractTextFromItemMock.mockResolvedValueOnce(ocrExtraction("Order #PF112233445"));
    await startAnalysis(db, workspaceId, "qe2", { evidenceRoot });

    const queue = getSuggestionQueue(db, workspaceId, { failedExtraction: true });
    expect(queue.items.some((i) => i.evidenceItemId === "qe1")).toBe(true);
    expect(queue.items.some((i) => i.evidenceItemId === "qe2")).toBe(false);
  });

  it("filters by stale analysis", async () => {
    insertItem("qs1", "Customer Photos/qs1.jpg");
    await startAnalysis(db, workspaceId, "qs1", { evidenceRoot });
    db.prepare("UPDATE evidence_items SET sha256 = 'changed-sha' WHERE id = 'qs1'").run();

    insertItem("qs2", "Customer Photos/qs2.jpg");
    await startAnalysis(db, workspaceId, "qs2", { evidenceRoot });

    const queue = getSuggestionQueue(db, workspaceId, { stale: true });
    expect(queue.items.some((i) => i.evidenceItemId === "qs1")).toBe(true);
    expect(queue.items.some((i) => i.evidenceItemId === "qs2")).toBe(false);
  });

  it("filters by no provider available", async () => {
    insertItem("qp1", "Customer Photos/qp1.jpg");
    await startAnalysis(db, workspaceId, "qp1", { evidenceRoot });
    const queue = getSuggestionQueue(db, workspaceId, { noProvider: true });
    expect(queue.items.some((i) => i.evidenceItemId === "qp1")).toBe(true); // no provider configured in this test environment
  });

  it("scopes to a specific batch job when jobId is given", async () => {
    insertItem("qj1", "Customer Photos/qj1.jpg");
    insertItem("qj2", "Customer Photos/qj2.jpg");
    const run1 = await startAnalysis(db, workspaceId, "qj1", { evidenceRoot });
    await startAnalysis(db, workspaceId, "qj2", { evidenceRoot });

    const jobId = db.prepare("INSERT INTO batch_analysis_jobs (workspace_id, status, selection_mode, total_count, deterministic_rule_version, evidence_type_registry_version) VALUES (?, 'completed', 'selected_ids', 1, 'x', 'x')").run(workspaceId)
      .lastInsertRowid as number;
    db.prepare("INSERT INTO batch_analysis_job_items (job_id, evidence_item_id, status, analysis_run_id) VALUES (?, 'qj1', 'succeeded', ?)").run(jobId, run1.run.id);

    const queue = getSuggestionQueue(db, workspaceId, { jobId });
    expect(queue.items.map((i) => i.evidenceItemId)).toEqual(["qj1"]);
  });

  it("does not show items whose suggestions have already all been accepted or rejected", async () => {
    insertItem("qr1", "Customer Photos/qr1.jpg");
    const run = await startAnalysis(db, workspaceId, "qr1", { evidenceRoot });
    db.prepare("UPDATE evidence_suggestions SET state = 'rejected' WHERE analysis_run_id = ?").run(run.run.id);
    const queue = getSuggestionQueue(db, workspaceId, {});
    expect(queue.items.some((i) => i.evidenceItemId === "qr1")).toBe(false);
  });
});
