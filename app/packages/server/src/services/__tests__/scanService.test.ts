import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, cpSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../scanService.js";
import { REPO_ROOT } from "../../config/repoRoot.js";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("runScan", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  let workspaceId: number;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    workspaceId = db
      .prepare("INSERT INTO workspaces (name, evidence_root) VALUES ('Golden', 'unused')")
      .run().lastInsertRowid as number;

    evidenceRoot = mkdtempSync(join(tmpdir(), "scan-service-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  it("discovers all 8 golden fixture files and creates one Evidence Item each", async () => {
    const summary = await runScan(db, workspaceId, evidenceRoot);

    expect(summary.status).toBe("completed");
    expect(summary.filesDiscovered).toBe(8);
    expect(summary.itemsCreated).toBe(8);
    expect(summary.itemsUpdated).toBe(0);
    expect(summary.itemsMissing).toBe(0);

    const count = db.prepare("SELECT COUNT(*) AS c FROM evidence_items WHERE workspace_id = ?").get(workspaceId) as {
      c: number;
    };
    expect(count.c).toBe(8);
  });

  it("detects the exact duplicate pair via SHA-256", async () => {
    const summary = await runScan(db, workspaceId, evidenceRoot);

    expect(summary.duplicateGroups).toBe(1);

    const dupRows = db
      .prepare("SELECT evidence_item_id FROM duplicates WHERE workspace_id = ?")
      .all(workspaceId) as { evidence_item_id: string }[];
    expect(dupRows).toHaveLength(2);
  });

  it("gives new items review_status 'unreviewed' and evidence_category 'unknown'", async () => {
    await runScan(db, workspaceId, evidenceRoot);

    const rows = db
      .prepare("SELECT review_status, evidence_category FROM evidence_items WHERE workspace_id = ?")
      .all(workspaceId) as { review_status: string; evidence_category: string }[];

    for (const row of rows) {
      expect(row.review_status).toBe("unreviewed");
      expect(row.evidence_category).toBe("unknown");
    }
  });

  it("persists deterministic metadata alongside items", async () => {
    await runScan(db, workspaceId, evidenceRoot);

    const row = db
      .prepare(
        `SELECT fm.width, fm.height FROM file_metadata fm
         JOIN evidence_items ei ON ei.id = fm.evidence_item_id
         WHERE ei.original_path = 'product_photo.jpg'`,
      )
      .get() as { width: number; height: number };

    expect(row.width).toBe(60);
    expect(row.height).toBe(40);
  });

  it("a second scan with no filesystem changes reports everything unchanged (idempotent)", async () => {
    await runScan(db, workspaceId, evidenceRoot);
    const second = await runScan(db, workspaceId, evidenceRoot);

    expect(second.itemsCreated).toBe(0);
    expect(second.itemsUpdated).toBe(0);
    expect(second.itemsUnchanged).toBe(8);
    expect(second.itemsContentChanged).toBe(0);

    const count = db.prepare("SELECT COUNT(*) AS c FROM evidence_items WHERE workspace_id = ?").get(workspaceId) as {
      c: number;
    };
    expect(count.c).toBe(8);
  });

  it("preserves review data (confirmed status) across a rescan", async () => {
    await runScan(db, workspaceId, evidenceRoot);

    db.prepare(
      "UPDATE evidence_items SET review_status = 'reviewed', evidence_category = 'trademark_core' WHERE original_path = 'product_photo.jpg'",
    ).run();

    await runScan(db, workspaceId, evidenceRoot);

    const row = db
      .prepare("SELECT review_status, evidence_category FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { review_status: string; evidence_category: string };
    expect(row.review_status).toBe("reviewed");
    expect(row.evidence_category).toBe("trademark_core");
  });

  it("flags a file removed from disk as missing without deleting its Evidence Item", async () => {
    await runScan(db, workspaceId, evidenceRoot);

    unlinkSync(join(evidenceRoot, "unrelated_image.jpg"));
    const summary = await runScan(db, workspaceId, evidenceRoot);

    expect(summary.filesDiscovered).toBe(7);
    expect(summary.itemsMissing).toBe(1);

    const row = db
      .prepare("SELECT missing_since FROM evidence_items WHERE original_path = 'unrelated_image.jpg'")
      .get() as { missing_since: string | null };
    expect(row.missing_since).not.toBeNull();

    const count = db.prepare("SELECT COUNT(*) AS c FROM evidence_items WHERE workspace_id = ?").get(workspaceId) as {
      c: number;
    };
    expect(count.c).toBe(8); // still present, just flagged missing
  });

  it("detects a new file added between scans", async () => {
    await runScan(db, workspaceId, evidenceRoot);

    writeFileSync(join(evidenceRoot, "newly_added.txt"), "new evidence");
    const summary = await runScan(db, workspaceId, evidenceRoot);

    expect(summary.itemsCreated).toBe(1);
    expect(summary.itemsUnchanged).toBe(8);
  });

  it("detects and reports unexpected content changes to an existing path", async () => {
    await runScan(db, workspaceId, evidenceRoot);

    writeFileSync(join(evidenceRoot, "unrelated_image.jpg"), "completely different bytes");
    const summary = await runScan(db, workspaceId, evidenceRoot);

    expect(summary.itemsContentChanged).toBe(1);
    expect(summary.itemsUpdated).toBe(1);
  });

  it("un-flags a missing item once it reappears on disk", async () => {
    const originalPath = join(evidenceRoot, "unrelated_image.jpg");
    const backup = join(evidenceRoot, "..", "unrelated_image_backup.jpg");
    cpSync(originalPath, backup);
    unlinkSync(originalPath);
    await runScan(db, workspaceId, evidenceRoot);
    await runScan(db, workspaceId, evidenceRoot); // still missing on second scan

    cpSync(backup, originalPath);
    rmSync(backup, { force: true });
    const summary = await runScan(db, workspaceId, evidenceRoot);

    expect(summary.itemsMissing).toBe(0);
    const row = db
      .prepare("SELECT missing_since FROM evidence_items WHERE original_path = 'unrelated_image.jpg'")
      .get() as { missing_since: string | null };
    expect(row.missing_since).toBeNull();
  });

  it("rejects a concurrent scan while one is already running for the workspace", async () => {
    db.prepare("INSERT INTO scan_runs (workspace_id, status) VALUES (?, 'running')").run(workspaceId);

    await expect(runScan(db, workspaceId, evidenceRoot)).rejects.toThrow(/already running/);
  });

  it("records a completed scan_runs row with matching counters", async () => {
    const summary = await runScan(db, workspaceId, evidenceRoot);

    const row = db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(summary.scanRunId) as {
      status: string;
      files_discovered: number;
      items_created: number;
      completed_at: string | null;
    };
    expect(row.status).toBe("completed");
    expect(row.files_discovered).toBe(8);
    expect(row.items_created).toBe(8);
    expect(row.completed_at).not.toBeNull();
  });
});
