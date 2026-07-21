import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrate.js";

const { extractTextFromItemMock } = vi.hoisted(() => ({ extractTextFromItemMock: vi.fn() }));
vi.mock("../ocrService.js", () => ({ extractTextFromItem: extractTextFromItemMock, OcrError: class OcrError extends Error {} }));

// A thin, selectively-overridable wrapper around the real
// analysisService.startAnalysis — most tests exercise the genuine Phase
// 1 pipeline end to end (proving the batch job actually analyzes real
// items, not just plumbing), while failure-isolation/retry tests inject
// a rejection for chosen item ids the same way a real transient failure
// (a file that disappeared mid-batch, a corrupt read) would surface.
const { startAnalysisOverride } = vi.hoisted(() => ({ startAnalysisOverride: { failFor: new Set<string>() } }));
vi.mock("../analysisService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../analysisService.js")>();
  return {
    ...actual,
    startAnalysis: vi.fn(async (db: unknown, workspaceId: unknown, itemId: string, paths: unknown) => {
      if (startAnalysisOverride.failFor.has(itemId)) {
        throw new Error(`Simulated failure analyzing ${itemId}`);
      }
      return actual.startAnalysis(db as never, workspaceId as never, itemId, paths as never);
    }),
  };
});

import {
  BatchAnalysisJobNotFoundError,
  BatchAnalysisValidationError,
  getBatchAnalysisJobStatus,
  previewBatchAnalysisSelection,
  reconcileAbandonedBatchAnalysisJobs,
  requestBatchAnalysisCancellation,
  startBatchAnalysis,
} from "../batchAnalysisService.js";

function ocrExtraction(rawText = "") {
  return { rawText, dateCandidates: [], orderNumberCandidates: [] };
}

async function waitForBatchDone(db: Database.Database, workspaceId: number, jobId: number, maxIterations = 200) {
  for (let i = 0; i < maxIterations; i++) {
    const job = getBatchAnalysisJobStatus(db, workspaceId, jobId)!;
    if (job.status !== "running" && job.status !== "queued") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("batch analysis job did not finish in time");
}

describe("batchAnalysisService", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;
  const paths = { evidenceRoot: "" };

  beforeEach(() => {
    vi.clearAllMocks();
    startAnalysisOverride.failFor.clear();
    extractTextFromItemMock.mockResolvedValue(ocrExtraction());
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();
    evidenceRoot = mkdtempSync(join(tmpdir(), "batch-analysis-test-"));
    paths.evidenceRoot = evidenceRoot;
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  function insertItem(id: string, relativePath: string, opts: { reviewStatus?: string; sha256?: string } = {}) {
    const abs = join(evidenceRoot, relativePath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "content");
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256, review_status)
       VALUES (?, ?, ?, ?, ?, 'image/jpeg', 100, ?, ?)`,
    ).run(id, workspaceId, relativePath, relativePath.split("/").pop(), relativePath.split(".").pop(), opts.sha256 ?? `sha-${id}`, opts.reviewStatus ?? "unreviewed");
  }

  function markMissing(id: string) {
    db.prepare("UPDATE evidence_items SET missing_since = datetime('now') WHERE id = ?").run(id);
  }

  // --- selection modes ---

  it("selectionMode 'selected_ids' analyzes exactly the given items, ignoring unknown ids", async () => {
    insertItem("s1", "Folder/s1.jpg");
    insertItem("s2", "Folder/s2.jpg");
    insertItem("s3", "Folder/s3.jpg");
    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["s1", "s3", "does-not-exist"] }, 2);
    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.totalCount).toBe(2);
    expect(job.succeededCount).toBe(2);
    const analyzed = db.prepare("SELECT evidence_item_id FROM batch_analysis_job_items WHERE job_id = ? ORDER BY evidence_item_id").all(jobId) as { evidence_item_id: string }[];
    expect(analyzed.map((r) => r.evidence_item_id)).toEqual(["s1", "s3"]);
  });

  it("selectionMode 'selected_ids' rejects an empty or all-unknown id list", async () => {
    await expect(startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: [] })).rejects.toBeInstanceOf(BatchAnalysisValidationError);
    await expect(startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["nope"] })).rejects.toBeInstanceOf(BatchAnalysisValidationError);
  });

  it("selectionMode 'folder' analyzes exactly the items in that folder, not subfolders or siblings", async () => {
    insertItem("f1", "Customer Photos/f1.jpg");
    insertItem("f2", "Customer Photos/f2.jpg");
    insertItem("f3", "Customer Photos/Sub/f3.jpg");
    insertItem("f4", "Product Photos/f4.jpg");
    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "folder", folderPath: "Customer Photos" }, 2);
    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.totalCount).toBe(2);
    const analyzed = (db.prepare("SELECT evidence_item_id FROM batch_analysis_job_items WHERE job_id = ? ORDER BY evidence_item_id").all(jobId) as { evidence_item_id: string }[]).map(
      (r) => r.evidence_item_id,
    );
    expect(analyzed).toEqual(["f1", "f2"]);
  });

  it("selectionMode 'all_unreviewed' reads the live count from the database, never a hardcoded number", async () => {
    insertItem("u1", "A/u1.jpg", { reviewStatus: "unreviewed" });
    insertItem("u2", "A/u2.jpg", { reviewStatus: "reviewed" });
    const firstJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "all_unreviewed" }, 2);
    const firstJob = await waitForBatchDone(db, workspaceId, firstJobId);
    expect(firstJob.totalCount).toBe(1); // only u1 — u2 is already reviewed

    // Analysis alone never changes review_status, so u1 is still
    // 'unreviewed' and a fresh count picks it up again alongside a
    // newly-added unreviewed item — this is what "live, not hardcoded"
    // means in practice.
    insertItem("u3", "A/u3.jpg", { reviewStatus: "unreviewed" });
    const secondJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "all_unreviewed" }, 2);
    const secondJob = await waitForBatchDone(db, workspaceId, secondJobId);
    expect(secondJob.totalCount).toBe(2);

    // Once u1 is actually marked reviewed (a real review_status change,
    // unrelated to analysis), a fresh count correctly excludes it.
    db.prepare("UPDATE evidence_items SET review_status = 'reviewed' WHERE id = 'u1'").run();
    const thirdJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "all_unreviewed" }, 2);
    const thirdJob = await waitForBatchDone(db, workspaceId, thirdJobId);
    expect(thirdJob.totalCount).toBe(1);
  });

  it("selectionMode 'stale' only selects items with an existing stale analysis, never never-analyzed or current ones", async () => {
    insertItem("never", "A/never.jpg");
    insertItem("current", "A/current.jpg", { sha256: "sha-current" });
    insertItem("stale", "A/stale.jpg", { sha256: "sha-stale-original" });

    // Give "current" and "stale" a real analysis run first.
    const setupJob = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["current", "stale"] }, 2);
    await waitForBatchDone(db, workspaceId, setupJob);

    // Change "stale"'s content so its existing run's fingerprint no longer matches.
    db.prepare("UPDATE evidence_items SET sha256 = 'sha-stale-changed' WHERE id = 'stale'").run();

    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "stale" }, 2);
    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.totalCount).toBe(1);
    const analyzed = (db.prepare("SELECT evidence_item_id FROM batch_analysis_job_items WHERE job_id = ?").all(jobId) as { evidence_item_id: string }[]).map((r) => r.evidence_item_id);
    expect(analyzed).toEqual(["stale"]);
  });

  it("selectionMode 'retry_failed' selects exactly the failed items from the named prior job", async () => {
    insertItem("r1", "A/r1.jpg");
    insertItem("r2", "A/r2.jpg");
    insertItem("r3", "A/r3.jpg");
    startAnalysisOverride.failFor.add("r2");
    const firstJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["r1", "r2", "r3"] }, 3);
    const firstJob = await waitForBatchDone(db, workspaceId, firstJobId);
    expect(firstJob.status).toBe("completed_with_failures");
    expect(firstJob.failedCount).toBe(1);

    startAnalysisOverride.failFor.clear(); // the underlying issue is now resolved
    const retryJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "retry_failed", sourceJobId: firstJobId }, 2);
    const retryJob = await waitForBatchDone(db, workspaceId, retryJobId);
    expect(retryJob.totalCount).toBe(1);
    expect(retryJob.succeededCount).toBe(1);
    const analyzed = (db.prepare("SELECT evidence_item_id FROM batch_analysis_job_items WHERE job_id = ?").all(retryJobId) as { evidence_item_id: string }[]).map((r) => r.evidence_item_id);
    expect(analyzed).toEqual(["r2"]);
  });

  it("selectionMode 'retry_failed' with an unknown source job id throws", async () => {
    await expect(startBatchAnalysis(db, workspaceId, paths, { selectionMode: "retry_failed", sourceJobId: 999999 })).rejects.toBeInstanceOf(BatchAnalysisJobNotFoundError);
  });

  it("a missing (unreadable) item matched by a selection is recorded as skipped, never attempted", async () => {
    insertItem("m1", "A/m1.jpg");
    markMissing("m1");
    insertItem("m2", "A/m2.jpg");
    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["m1", "m2"] }, 2);
    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.totalCount).toBe(2);
    expect(job.skippedCount).toBe(1);
    expect(job.succeededCount).toBe(1);
    const m1Row = db.prepare("SELECT status FROM batch_analysis_job_items WHERE job_id = ? AND evidence_item_id = 'm1'").get(jobId) as { status: string };
    expect(m1Row.status).toBe("skipped");
  });

  // --- progress persistence ---

  it("progress (processed/succeeded/failed counts) advances as each item completes, not only once at the end", async () => {
    insertItem("p1", "A/p1.jpg");
    insertItem("p2", "A/p2.jpg");
    insertItem("p3", "A/p3.jpg");

    // Gate the second item's OCR call so the job provably can't reach
    // "all processed" before this test observes the in-between state —
    // without this, an all-synchronous/mocked pipeline can finish the
    // whole batch faster than any polling interval could ever catch.
    let releaseSecond!: () => void;
    const gate = new Promise<void>((resolve) => (releaseSecond = resolve));
    const { extractTextFromItem } = await import("../ocrService.js");
    let callCount = 0;
    (extractTextFromItem as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) await gate;
      return ocrExtraction();
    });

    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["p1", "p2", "p3"] }, 1); // concurrency 1: strictly sequential

    let sawIntermediateProgress = false;
    for (let i = 0; i < 200; i++) {
      const job = getBatchAnalysisJobStatus(db, workspaceId, jobId)!;
      if (job.processedCount > 0 && job.processedCount < job.totalCount) {
        sawIntermediateProgress = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2));
    }
    releaseSecond();
    await waitForBatchDone(db, workspaceId, jobId);
    expect(sawIntermediateProgress).toBe(true);
  });

  it("current_item_id is set while an item is being processed and cleared once the job finishes", async () => {
    insertItem("c1", "A/c1.jpg");
    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["c1"] }, 1);
    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.currentItemId).toBeNull();
  });

  // --- duplicate-job prevention / abandoned-job reconciliation / cancellation ---

  it("duplicate-active-job prevention: a second call while a job is genuinely still active returns the same job id", async () => {
    insertItem("d1", "A/d1.jpg");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { extractTextFromItem } = await import("../ocrService.js");
    (extractTextFromItem as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return ocrExtraction();
    });

    const firstJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["d1"] }, 1);
    const secondJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["d1"] }, 1);
    expect(secondJobId).toBe(firstJobId);

    release();
    await waitForBatchDone(db, workspaceId, firstJobId);
  });

  it("a job left 'running' by a previous process is reconciled to 'interrupted' and does not block a new batch", async () => {
    const staleJobId = db
      .prepare("INSERT INTO batch_analysis_jobs (workspace_id, status, selection_mode, total_count, deterministic_rule_version, evidence_type_registry_version) VALUES (?, 'running', 'all_unreviewed', 3, 'x', 'x')")
      .run(workspaceId).lastInsertRowid as number;

    insertItem("recon-1", "A/recon1.jpg");
    const newJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["recon-1"] }, 1);
    expect(newJobId).not.toBe(staleJobId);

    const stale = getBatchAnalysisJobStatus(db, workspaceId, staleJobId)!;
    expect(stale.status).toBe("interrupted");
    expect(stale.errorSummary).toBeTruthy();

    const newJob = await waitForBatchDone(db, workspaceId, newJobId);
    expect(newJob.status).toBe("completed");
  });

  it("reconcileAbandonedBatchAnalysisJobs never touches a job actually still running in this process", async () => {
    insertItem("live-1", "A/live1.jpg");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { extractTextFromItem } = await import("../ocrService.js");
    (extractTextFromItem as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return ocrExtraction();
    });

    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["live-1"] }, 1);
    await new Promise((r) => setTimeout(r, 20));

    reconcileAbandonedBatchAnalysisJobs(db, workspaceId);
    expect(getBatchAnalysisJobStatus(db, workspaceId, jobId)!.status).toBe("running");

    release();
    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.status).toBe("completed");
  });

  it("cancellation between items: remaining unprocessed items are skipped, not attempted, and the job ends 'canceled'", async () => {
    insertItem("x1", "A/x1.jpg");
    insertItem("x2", "A/x2.jpg");
    insertItem("x3", "A/x3.jpg");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { extractTextFromItem } = await import("../ocrService.js");
    let firstCallStarted = false;
    (extractTextFromItem as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (!firstCallStarted) {
        firstCallStarted = true;
        await gate;
      }
      return ocrExtraction();
    });

    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["x1", "x2", "x3"] }, 1); // sequential
    await new Promise((r) => setTimeout(r, 10));
    const canceled = requestBatchAnalysisCancellation(db, workspaceId, jobId);
    expect(canceled).toBe(true);
    release();

    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.status).toBe("canceled");
    expect(job.processedCount).toBeLessThan(3);
    const skippedRows = db.prepare("SELECT COUNT(*) AS c FROM batch_analysis_job_items WHERE job_id = ? AND status = 'skipped'").get(jobId) as { c: number };
    expect(skippedRows.c).toBeGreaterThan(0);
  });

  it("cancelling an already-terminal or unknown job returns false", async () => {
    expect(requestBatchAnalysisCancellation(db, workspaceId, 999999)).toBe(false);
  });

  // --- per-item failure isolation ---

  it("one item's analysis failure does not block the rest of the batch, and is recorded with a safe error message", async () => {
    insertItem("ok1", "A/ok1.jpg");
    insertItem("bad", "A/bad.jpg");
    insertItem("ok2", "A/ok2.jpg");
    startAnalysisOverride.failFor.add("bad");

    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["ok1", "bad", "ok2"] }, 3);
    const job = await waitForBatchDone(db, workspaceId, jobId);
    expect(job.status).toBe("completed_with_failures");
    expect(job.succeededCount).toBe(2);
    expect(job.failedCount).toBe(1);
    const badRow = db.prepare("SELECT status, error FROM batch_analysis_job_items WHERE job_id = ? AND evidence_item_id = 'bad'").get(jobId) as { status: string; error: string };
    expect(badRow.status).toBe("failed");
    expect(badRow.error).toContain("Simulated failure");
  });

  // --- idempotency / no permanent mutation ---

  it("re-analyzing the same item across two batch runs is safe and idempotent — no duplicate confirmed data, no error", async () => {
    insertItem("idem-1", "A/idem1.jpg");
    const firstJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["idem-1"] }, 1);
    await waitForBatchDone(db, workspaceId, firstJobId);
    const secondJobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["idem-1"] }, 1);
    const secondJob = await waitForBatchDone(db, workspaceId, secondJobId);
    expect(secondJob.status).toBe("completed");
    const runs = db.prepare("SELECT COUNT(*) AS c FROM analysis_runs WHERE evidence_item_id = 'idem-1'").get() as { c: number };
    expect(runs.c).toBe(2); // reanalysis creates a new run and supersedes the old one — never duplicates confirmed data
    const superseded = db.prepare("SELECT COUNT(*) AS c FROM analysis_runs WHERE evidence_item_id = 'idem-1' AND superseded_at IS NOT NULL").get() as { c: number };
    expect(superseded.c).toBe(1);
  });

  it("running a batch job never writes to evidence_items, review_answers, or connections for any item it touches", async () => {
    insertItem("safe-1", "A/safe1.jpg");
    insertItem("safe-2", "A/safe2.jpg");
    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ["safe-1", "safe-2"] }, 2);
    await waitForBatchDone(db, workspaceId, jobId);

    const items = db.prepare("SELECT evidence_type_id, review_status, inclusion_decision, notes FROM evidence_items WHERE id IN ('safe-1', 'safe-2')").all() as {
      evidence_type_id: string | null;
      review_status: string;
      inclusion_decision: string | null;
      notes: string | null;
    }[];
    for (const item of items) {
      expect(item.evidence_type_id).toBeNull();
      expect(item.review_status).toBe("unreviewed");
      expect(item.inclusion_decision).toBeNull();
    }
    expect((db.prepare("SELECT COUNT(*) AS c FROM review_answers").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM connections").get() as { c: number }).c).toBe(0);
  });

  // --- large result sets ---

  it("processes a large selection (50 items) completely, with counts that add up exactly", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `bulk-${i}`;
      insertItem(id, `A/bulk-${i}.jpg`);
      ids.push(id);
    }
    const jobId = await startBatchAnalysis(db, workspaceId, paths, { selectionMode: "selected_ids", itemIds: ids }, 5);
    const job = await waitForBatchDone(db, workspaceId, jobId, 1000);
    expect(job.status).toBe("completed");
    expect(job.totalCount).toBe(50);
    expect(job.processedCount).toBe(50);
    expect(job.succeededCount).toBe(50);
    expect(job.succeededCount + job.failedCount + job.skippedCount).toBe(job.totalCount);
  });

  // --- preview report ---

  it("previewBatchAnalysisSelection reports eligible count, folders, file types, and unreadable items without starting a job", () => {
    insertItem("pv1", "Customer Photos/pv1.jpg");
    insertItem("pv2", "Printful Orders/pv2.png");
    insertItem("pv3", "Customer Photos/pv3.jpg");
    markMissing("pv3");
    const preview = previewBatchAnalysisSelection(db, workspaceId, { selectionMode: "selected_ids", itemIds: ["pv1", "pv2", "pv3"] });
    expect(preview.eligibleCount).toBe(2);
    expect(preview.unreadableCount).toBe(1);
    expect(preview.folders.sort()).toEqual(["Customer Photos", "Printful Orders"]);
    expect(preview.fileTypeBreakdown.jpg).toBe(1);
    expect(preview.fileTypeBreakdown.png).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS c FROM batch_analysis_jobs").get() as { c: number }).c).toBe(0);
  });
});
