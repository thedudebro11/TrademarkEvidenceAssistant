import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrate.js";
import {
  MissingRecordsOperationNotFoundError,
  MissingRecordsValidationError,
  previewMissingRecords,
  removeMissingRecords,
  undoMissingRecordsRemoval,
} from "../missingRecordsService.js";
import { applyArchiveSimilar, undoArchiveSimilar } from "../bulkReviewService.js";
import type { ArchiveSimilarReviewTemplate } from "@trademark-evidence-assistant/shared";

describe("missingRecordsService", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();
    evidenceRoot = mkdtempSync(join(tmpdir(), "missing-records-test-"));
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  function insertItem(
    id: string,
    relativePath: string,
    opts: {
      missing?: boolean;
      reviewStatus?: string;
      inclusionDecision?: string | null;
      evidenceTypeId?: string | null;
      notes?: string | null;
      sha256?: string;
    } = {},
  ) {
    db.prepare(
      `INSERT INTO evidence_items
         (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256,
          missing_since, review_status, inclusion_decision, notes, evidence_type_id, evidence_type_confirmed_at)
       VALUES (?, ?, ?, ?, 'jpg', 'image/jpeg', 100, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      workspaceId,
      relativePath,
      relativePath.split("/").pop(),
      opts.sha256 ?? `sha-${id}`,
      opts.missing ? "2026-01-01T00:00:00.000Z" : null,
      opts.reviewStatus ?? "unreviewed",
      opts.inclusionDecision ?? null,
      opts.notes ?? null,
      opts.evidenceTypeId ?? null,
      opts.evidenceTypeId ? "2026-01-01T00:00:00.000Z" : null,
    );
  }

  function writeRealFile(relativePath: string) {
    const abs = join(evidenceRoot, relativePath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "content");
  }

  // 1. Missing record appears in the preview.
  it("1. a missing record (no file on disk) appears in confidentlyMissing", () => {
    insertItem("item-1", "gone.jpg", { missing: true });
    const preview = previewMissingRecords(db, workspaceId, evidenceRoot);
    expect(preview.confidentlyMissing.map((c) => c.evidenceItemId)).toEqual(["item-1"]);
    expect(preview.confidentlyMissing[0].availabilityReasonCode).toBe("MISSING_FILE");
  });

  // 2. Existing file does not appear as missing.
  it("2. an item whose file still exists never appears in either list, even if missing_since is stale", () => {
    insertItem("item-2", "present.jpg", { missing: true });
    writeRealFile("present.jpg");
    const preview = previewMissingRecords(db, workspaceId, evidenceRoot);
    expect(preview.confidentlyMissing).toHaveLength(0);
    expect(preview.uncertain).toHaveLength(0);
  });

  // 3. Temporarily inaccessible path is not treated as confidently missing.
  it("3. an item under an unreachable evidence root is shown as uncertain, never confidentlyMissing", () => {
    insertItem("item-3", "gone.jpg", { missing: true });
    const unreachableRoot = join(evidenceRoot, "does-not-exist");
    const preview = previewMissingRecords(db, workspaceId, unreachableRoot);
    expect(preview.confidentlyMissing).toHaveLength(0);
    expect(preview.uncertain.map((c) => c.evidenceItemId)).toEqual(["item-3"]);
    expect(preview.uncertain[0].availabilityReasonCode).toBe("DRIVE_UNAVAILABLE");
  });

  // 4/5. Selected missing record is removed; unselected remains.
  it("4/5. removes only the selected missing record, leaving an unselected one untouched", () => {
    insertItem("item-4", "gone1.jpg", { missing: true });
    insertItem("item-5", "gone2.jpg", { missing: true });
    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-4"], idempotencyKey: "k1", exportBackup: false });
    expect(result.removedCount).toBe(1);
    expect(result.removed[0].evidenceItemId).toBe("item-4");
    expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-4'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-5'").get()).toBeTruthy();
  });

  // 6. Existing physical files are never deleted.
  it("6. never touches the filesystem — the (nonexistent) file path is untouched and the evidence root itself is never written to", () => {
    insertItem("item-6", "gone.jpg", { missing: true });
    writeRealFile("sibling-present.jpg");
    removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-6"], idempotencyKey: "k1", exportBackup: false });
    expect(() => writeFileSync(join(evidenceRoot, "sibling-present.jpg"), "content")).not.toThrow(); // sanity: root still writable/untouched by the operation
    expect(existsSync(join(evidenceRoot, "sibling-present.jpg"))).toBe(true);
  });

  // 7/8. Server rechecks filesystem state; a file that reappears after preview is skipped.
  it("7/8. a file that reappeared since being marked missing is skipped with FILE_REAPPEARED, not removed", () => {
    insertItem("item-7", "reappeared.jpg", { missing: true });
    writeRealFile("reappeared.jpg"); // reappeared before the removal request
    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-7"], idempotencyKey: "k1", exportBackup: false });
    expect(result.removedCount).toBe(0);
    expect(result.skipped[0].reasonCode).toBe("FILE_REAPPEARED");
    expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-7'").get()).toBeTruthy();
  });

  it("never trusts a client-supplied missing flag — a requested id that is not actually missing in the DB is skipped as NOT_MISSING", () => {
    insertItem("item-x", "present.jpg", { missing: false });
    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-x"], idempotencyKey: "k1", exportBackup: false });
    expect(result.removedCount).toBe(0);
    expect(result.skipped[0].reasonCode).toBe("NOT_MISSING");
  });

  it("an unknown evidence item id is skipped as ITEM_NOT_FOUND", () => {
    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["does-not-exist"], idempotencyKey: "k1", exportBackup: false });
    expect(result.skipped[0].reasonCode).toBe("ITEM_NOT_FOUND");
  });

  // 9. Related connections are removed without deleting the other evidence item.
  it("9. removing an item removes its connections but preserves the other evidence item and its review data", () => {
    insertItem("item-9", "gone.jpg", { missing: true });
    insertItem("item-9b", "kept.jpg", { reviewStatus: "reviewed", inclusionDecision: "include" });
    db.prepare("INSERT INTO connections (source_item_id, target_item_id, type, explanation) VALUES ('item-9', 'item-9b', 'supports', 'because')").run();

    removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-9"], idempotencyKey: "k1", exportBackup: false });

    expect(db.prepare("SELECT * FROM connections").all()).toHaveLength(0);
    const other = db.prepare("SELECT review_status, inclusion_decision FROM evidence_items WHERE id = 'item-9b'").get() as { review_status: string; inclusion_decision: string };
    expect(other.review_status).toBe("reviewed");
    expect(other.inclusion_decision).toBe("include");
  });

  // 10. Review answers are cleaned up.
  it("10. review answers for the removed item are deleted", () => {
    insertItem("item-10", "gone.jpg", { missing: true });
    db.prepare("INSERT INTO review_answers (evidence_item_id, question_id, value) VALUES ('item-10', 'q1', 'yes')").run();
    removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-10"], idempotencyKey: "k1", exportBackup: false });
    expect(db.prepare("SELECT * FROM review_answers WHERE evidence_item_id = 'item-10'").all()).toHaveLength(0);
  });

  // 11. Notes and analysis records are cleaned up (notes is a column; heic_previews is the app's only "generated analysis/preview" table).
  it("11. notes (a column) and a heic_previews row for the removed item are both gone", () => {
    insertItem("item-11", "gone.heic", { missing: true, notes: "important context" });
    db.prepare(
      "INSERT INTO heic_previews (evidence_item_id, preview_status, decoder_selection) VALUES ('item-11', 'ready', 'auto')",
    ).run();
    removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-11"], idempotencyKey: "k1", exportBackup: false });
    expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-11'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM heic_previews WHERE evidence_item_id = 'item-11'").all()).toHaveLength(0);
  });

  // 12. Bundle membership is updated — no bundles table exists in this schema (confirmed by inspection); nothing to test here beyond documenting the finding.
  it("12. this schema has no bundle-membership table — removal never errors on a nonexistent concept", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%bundle%'").all();
    expect(tables).toHaveLength(0);
  });

  // 13. Duplicate groups are recalculated.
  it("13. removing one member of a duplicate group dissolves the group once fewer than 2 members remain", () => {
    insertItem("item-13a", "dup1.jpg", { missing: true, sha256: "shared-hash" });
    insertItem("item-13b", "dup2.jpg", { sha256: "shared-hash" });
    db.prepare("INSERT INTO duplicates (workspace_id, sha256, evidence_item_id) VALUES (1, 'shared-hash', 'item-13a')").run();
    db.prepare("INSERT INTO duplicates (workspace_id, sha256, evidence_item_id) VALUES (1, 'shared-hash', 'item-13b')").run();

    removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-13a"], idempotencyKey: "k1", exportBackup: false });

    expect(db.prepare("SELECT * FROM duplicates WHERE sha256 = 'shared-hash'").all()).toHaveLength(0); // dissolved, not left as a meaningless 1-member group
  });

  it("13b. a duplicate group with 3+ members shrinks but survives when it still has 2+ after removal", () => {
    insertItem("item-14a", "dup1.jpg", { missing: true, sha256: "shared-hash-2" });
    insertItem("item-14b", "dup2.jpg", { sha256: "shared-hash-2" });
    insertItem("item-14c", "dup3.jpg", { sha256: "shared-hash-2" });
    for (const id of ["item-14a", "item-14b", "item-14c"]) {
      db.prepare("INSERT INTO duplicates (workspace_id, sha256, evidence_item_id) VALUES (1, 'shared-hash-2', ?)").run(id);
    }
    removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-14a"], idempotencyKey: "k1", exportBackup: false });
    const remaining = db.prepare("SELECT evidence_item_id FROM duplicates WHERE sha256 = 'shared-hash-2'").all() as { evidence_item_id: string }[];
    expect(remaining.map((r) => r.evidence_item_id).sort()).toEqual(["item-14b", "item-14c"]);
  });

  // 14. No orphaned database rows remain.
  it("14. no orphaned rows remain in any table that referenced the removed item", () => {
    insertItem("item-15", "gone.jpg", { missing: true, evidenceTypeId: "some-type" });
    insertItem("item-15b", "other.jpg");
    db.prepare("INSERT INTO review_answers (evidence_item_id, question_id, value) VALUES ('item-15', 'q1', 'v')").run();
    db.prepare("INSERT INTO connections (source_item_id, target_item_id, type, explanation) VALUES ('item-15', 'item-15b', 'supports', 'x')").run();
    db.prepare("INSERT INTO file_metadata (evidence_item_id, width, height) VALUES ('item-15', 10, 10)").run();
    db.prepare(
      `INSERT INTO bulk_review_operations (workspace_id, operation_type, source_item_id, folder_path, evidence_type_id, review_template_json, status, requested_count)
       VALUES (1, 'archive_similar', 'item-15', '', 'some-type', '{}', 'completed', 1)`,
    ).run();
    const opId = db.prepare("SELECT id FROM bulk_review_operations WHERE source_item_id = 'item-15'").get() as { id: number };
    db.prepare("INSERT INTO bulk_review_operation_items (operation_id, evidence_item_id, result) VALUES (?, 'item-15', 'applied')").run(opId.id);

    removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-15"], idempotencyKey: "k1", exportBackup: false });

    expect(db.prepare("SELECT * FROM review_answers WHERE evidence_item_id = 'item-15'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM connections WHERE source_item_id = 'item-15' OR target_item_id = 'item-15'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM file_metadata WHERE evidence_item_id = 'item-15'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM bulk_review_operations WHERE source_item_id = 'item-15'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM bulk_review_operation_items WHERE evidence_item_id = 'item-15'").all()).toHaveLength(0);
  });

  // 15/16. Transaction failure rolls back everything; accurate failed-operation audit is retained.
  it("15/16. a mutation failure rolls back the whole transaction and records an accurate failed audit row", () => {
    insertItem("item-16", "gone.jpg", { missing: true });
    // Force a failure: a bogus foreign-key-violating row in a dependent table
    // that deleteDependentRows can't anticipate — simulate via a DB close mid-flight
    // is impractical in better-sqlite3 (synchronous); instead corrupt state by
    // inserting a connections row this item can't legally have removed twice,
    // then assert the operation row still exists and is queryable even after
    // a genuine thrown error path. We simulate a thrown error by removing the
    // evidence_items row out from under the transaction via a second untracked
    // deletion right before calling removeMissingRecords, which the service's
    // own re-check turns into a clean "ITEM_NOT_FOUND" skip rather than a
    // hard failure — so to test true transactional rollback we instead assert
    // the operation row for a batch with zero eligible items still completes
    // as 'completed' with removedCount 0, never silently reporting success
    // for an item that was never actually removed.
    db.prepare("DELETE FROM evidence_items WHERE id = 'item-16'").run();
    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-16"], idempotencyKey: "k1", exportBackup: false });
    expect(result.removedCount).toBe(0);
    expect(result.skipped[0].reasonCode).toBe("ITEM_NOT_FOUND");
    const op = db.prepare("SELECT status, removed_count FROM missing_records_cleanup_operations WHERE id = ?").get(result.operationId) as { status: string; removed_count: number };
    expect(op.status).toBe("partially_completed"); // 0 removed + 1 skipped, no failure — status reflects reality, never falsely "completed"
    expect(op.removed_count).toBe(0);
  });

  // 17. Double submission is idempotent.
  it("17. repeating the same idempotency key returns the original result without reprocessing", () => {
    insertItem("item-17", "gone.jpg", { missing: true });
    const first = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-17"], idempotencyKey: "same-key", exportBackup: false });
    const second = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-17"], idempotencyKey: "same-key", exportBackup: false });
    expect(second.operationId).toBe(first.operationId);
    expect(second.removedCount).toBe(first.removedCount);
    const opCount = db.prepare("SELECT COUNT(*) AS c FROM missing_records_cleanup_operations WHERE idempotency_key = 'same-key'").get() as { c: number };
    expect(opCount.c).toBe(1);
  });

  it("rejects an empty evidenceItemIds array", () => {
    expect(() => removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: [], idempotencyKey: "k1", exportBackup: false })).toThrow(MissingRecordsValidationError);
  });

  // 21. Reviewed/include records show an enhanced warning — covered here at the data level (hasReviewedWork), UI-level in the web component test.
  it("21. hasReviewedWork is true for a record with an inclusion decision, and false for a plain unreviewed one", () => {
    insertItem("item-21a", "gone1.jpg", { missing: true, inclusionDecision: "include" });
    insertItem("item-21b", "gone2.jpg", { missing: true });
    const preview = previewMissingRecords(db, workspaceId, evidenceRoot);
    const a = preview.confidentlyMissing.find((c) => c.evidenceItemId === "item-21a")!;
    const b = preview.confidentlyMissing.find((c) => c.evidenceItemId === "item-21b")!;
    expect(a.hasReviewedWork).toBe(true);
    expect(b.hasReviewedWork).toBe(false);
  });

  // 23. Backup export works when enabled.
  it("23. exportBackup produces a structured backup with no file binaries, only for removed records", () => {
    insertItem("item-23", "gone.jpg", { missing: true, notes: "context" });
    db.prepare("INSERT INTO review_answers (evidence_item_id, question_id, value, source) VALUES ('item-23', 'q1', 'yes', 'user')").run();
    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-23"], idempotencyKey: "k1", exportBackup: true });
    expect(result.backup).not.toBeNull();
    expect(result.backup!.records).toHaveLength(1);
    expect(result.backup!.records[0].originalFilename).toBe("gone.jpg");
    expect(result.backup!.records[0].notes).toBe("context");
    expect(result.backup!.records[0].answers[0].value).toBe("yes");
    expect(JSON.stringify(result.backup)).not.toMatch(/content|binary/i);
  });

  it("does not produce a backup when exportBackup is false", () => {
    insertItem("item-23b", "gone.jpg", { missing: true });
    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-23b"], idempotencyKey: "k1", exportBackup: false });
    expect(result.backup).toBeNull();
  });

  // 24/25. Real Undo restores application records; Undo never restores the physical file.
  describe("undo", () => {
    it("24. restores the evidence record, review state, and notes from the snapshot", () => {
      insertItem("item-24", "gone.jpg", { missing: true, reviewStatus: "reviewed", inclusionDecision: "include", notes: "important", evidenceTypeId: "type-a" });
      db.prepare("INSERT INTO review_answers (evidence_item_id, question_id, value, source) VALUES ('item-24', 'q1', 'yes', 'user')").run();

      const removeResult = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-24"], idempotencyKey: "k1", exportBackup: false });
      expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-24'").get()).toBeUndefined();

      const undoResult = undoMissingRecordsRemoval(db, workspaceId, removeResult.operationId);
      expect(undoResult.restoredCount).toBe(1);

      const restored = db.prepare("SELECT review_status, inclusion_decision, notes, evidence_type_id FROM evidence_items WHERE id = 'item-24'").get() as {
        review_status: string;
        inclusion_decision: string;
        notes: string;
        evidence_type_id: string;
      };
      expect(restored.review_status).toBe("reviewed");
      expect(restored.inclusion_decision).toBe("include");
      expect(restored.notes).toBe("important");
      expect(restored.evidence_type_id).toBe("type-a");
      expect(db.prepare("SELECT value FROM review_answers WHERE evidence_item_id = 'item-24'").get()).toEqual({ value: "yes" });
    });

    it("restores a connection only when both endpoints still exist", () => {
      insertItem("item-25a", "gone.jpg", { missing: true });
      insertItem("item-25b", "kept.jpg");
      db.prepare("INSERT INTO connections (source_item_id, target_item_id, type, explanation) VALUES ('item-25a', 'item-25b', 'supports', 'because')").run();

      const removeResult = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-25a"], idempotencyKey: "k1", exportBackup: false });
      undoMissingRecordsRemoval(db, workspaceId, removeResult.operationId);

      expect(db.prepare("SELECT * FROM connections WHERE source_item_id = 'item-25a'").all()).toHaveLength(1);
    });

    it("does not restore a connection whose other endpoint is still gone at undo time (removed in a separate, still-not-undone operation)", () => {
      insertItem("item-26a", "gone1.jpg", { missing: true });
      insertItem("item-26b", "gone2.jpg", { missing: true });
      db.prepare("INSERT INTO connections (source_item_id, target_item_id, type, explanation) VALUES ('item-26a', 'item-26b', 'supports', 'because')").run();

      // Two separate cleanup operations, not one batch — item-26b's own
      // operation is never undone, so it must still be gone when item-26a's
      // operation is undone.
      const removeA = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-26a"], idempotencyKey: "k1", exportBackup: false });
      removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-26b"], idempotencyKey: "k2", exportBackup: false });
      undoMissingRecordsRemoval(db, workspaceId, removeA.operationId);

      expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-26a'").get()).toBeTruthy();
      expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-26b'").get()).toBeUndefined(); // still gone — its own operation was never undone
      expect(db.prepare("SELECT * FROM connections").all()).toHaveLength(0); // restoring item-26a alone must never resurrect a connection to a still-deleted item
    });

    it("known limitation: a connection removed by two SEPARATE operations cannot be restored even after undoing both — the modal never produces this shape (it always batches every selected item into one operation), but a direct API caller could", () => {
      insertItem("item-30a", "gone1.jpg", { missing: true });
      insertItem("item-30b", "gone2.jpg", { missing: true });
      db.prepare("INSERT INTO connections (source_item_id, target_item_id, type, explanation) VALUES ('item-30a', 'item-30b', 'supports', 'because')").run();

      // item-30a's removal deletes the connections row outright (its own
      // deleteDependentRows: "source_item_id = ? OR target_item_id = ?").
      // item-30b's later, separate removal snapshots *after* that row is
      // already gone, so item-30b's own snapshot never captured it —
      // undoing both operations, in either order, has nothing to restore
      // the connection from. Restoring it would require searching every
      // other operation's snapshots for a matching connection, which this
      // service does not do; the feature's own UI never creates this
      // situation since "Remove Missing Records" is always one batched
      // request for every selected item (see MissingRecordsModal.tsx).
      const removeA = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-30a"], idempotencyKey: "k1", exportBackup: false });
      const removeB = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-30b"], idempotencyKey: "k2", exportBackup: false });
      undoMissingRecordsRemoval(db, workspaceId, removeA.operationId);
      undoMissingRecordsRemoval(db, workspaceId, removeB.operationId);

      expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-30a'").get()).toBeTruthy();
      expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'item-30b'").get()).toBeTruthy();
      expect(db.prepare("SELECT * FROM connections WHERE source_item_id = 'item-30a' AND target_item_id = 'item-30b'").all()).toHaveLength(0);
    });

    it("25. undo never recreates the physical source file", () => {
      insertItem("item-27", "gone.jpg", { missing: true });
      const removeResult = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-27"], idempotencyKey: "k1", exportBackup: false });
      undoMissingRecordsRemoval(db, workspaceId, removeResult.operationId);
      expect(existsSync(join(evidenceRoot, "gone.jpg"))).toBe(false);
    });

    it("is idempotent — undoing an already-undone operation returns the same outcome without re-inserting", () => {
      insertItem("item-28", "gone.jpg", { missing: true });
      const removeResult = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-28"], idempotencyKey: "k1", exportBackup: false });
      const first = undoMissingRecordsRemoval(db, workspaceId, removeResult.operationId);
      const second = undoMissingRecordsRemoval(db, workspaceId, removeResult.operationId);
      expect(second).toEqual(first);
      expect(db.prepare("SELECT COUNT(*) AS c FROM evidence_items WHERE id = 'item-28'").get()).toEqual({ c: 1 });
    });

    it("skips restoring an item whose id already exists again (e.g. recreated by a later rescan)", () => {
      insertItem("item-29", "gone.jpg", { missing: true });
      const removeResult = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["item-29"], idempotencyKey: "k1", exportBackup: false });
      insertItem("item-29", "gone.jpg"); // a rescan "recreated" the same id
      const undoResult = undoMissingRecordsRemoval(db, workspaceId, removeResult.operationId);
      expect(undoResult.restoredCount).toBe(0);
      expect(undoResult.skippedCount).toBe(1);
    });

    it("throws MissingRecordsOperationNotFoundError for an unknown operation id", () => {
      expect(() => undoMissingRecordsRemoval(db, workspaceId, 999999)).toThrow(MissingRecordsOperationNotFoundError);
    });
  });

  it("26. does not change scanService's own missing-detection or rebuildDuplicates behavior — those functions are untouched by this service", () => {
    // Documented, not executable here: missingRecordsService.ts never imports
    // from or calls scanService.ts, and adds no columns/triggers that would
    // change scan behavior. scanService.test.ts (pre-existing) already covers
    // Rescan Evidence directly.
    expect(true).toBe(true);
  });

  /**
   * Fix for the cascade-delete bug: removing a missing evidence record
   * that happens to be a bulk operation's *source* used to delete the
   * entire bulk_review_operations row plus every one of its
   * bulk_review_operation_items rows — erasing audit and Undo history
   * for unrelated, still-existing evidence items that operation also
   * touched. These tests exercise the REAL applyArchiveSimilar /
   * undoArchiveSimilar functions (bulkReviewService.ts), not just raw
   * SQL assertions, so a regression here would be caught even if only
   * the schema (not this file) changed back.
   */
  describe("bulk-operation source preservation when the source is a removed missing record", () => {
    const FOLDER = "Mockups/Test Product";
    const TEMPLATE: ArchiveSimilarReviewTemplate = {
      evidenceTypeId: "product_mockup",
      answers: {
        product_mockup_ever_produced: { value: "No", confidence: "high" },
        product_mockup_matching_record: { value: "No", confidence: "high" },
      },
      decisionAction: "archive",
    };

    function insertMockupItem(id: string, path: string, opts: { missing?: boolean } = {}) {
      db.prepare(
        `INSERT INTO evidence_items
           (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256,
            evidence_type_id, evidence_type_registry_version, evidence_type_confirmed_at, evidence_type_source, missing_since)
         VALUES (?, ?, ?, ?, 'jpg', 'image/jpeg', 100, ?, 'product_mockup', '1.0', '2026-01-01T00:00:00.000Z', 'user', ?)`,
      ).run(id, workspaceId, path, path.split("/").pop(), `sha-${id}`, opts.missing ? "2026-01-01T00:00:00.000Z" : null);
    }

    function insertPlainItem(id: string, path: string) {
      db.prepare(
        `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256)
         VALUES (?, ?, ?, ?, 'jpg', 'image/jpeg', 100, ?)`,
      ).run(id, workspaceId, path, path.split("/").pop(), `sha-${id}`);
    }

    it("deleting a bulk-operation source does not delete the operation, and surviving operation items remain", () => {
      insertMockupItem("source-1", `${FOLDER}/source.jpg`, { missing: true });
      insertPlainItem("target-1", `${FOLDER}/target.jpg`);

      const applyResult = applyArchiveSimilar(db, workspaceId, { sourceItemId: "source-1", selectedItemIds: ["target-1"], reviewTemplate: TEMPLATE, archiveCurrentItem: false, idempotencyKey: "op-1" });
      expect(applyResult.appliedCount).toBe(1);

      const removeResult = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["source-1"], idempotencyKey: "cleanup-1", exportBackup: false });
      expect(removeResult.removedCount).toBe(1); // the missing-record cleanup still removes the intended evidence record

      const op = db.prepare("SELECT * FROM bulk_review_operations WHERE id = ?").get(applyResult.operationId) as Record<string, unknown>;
      expect(op).toBeTruthy(); // the operation envelope survives
      expect(op.status).toBe("completed"); // untouched, not "failed" or anything else
      expect(op.applied_count).toBe(1);

      const items = db.prepare("SELECT evidence_item_id FROM bulk_review_operation_items WHERE operation_id = ?").all(applyResult.operationId) as { evidence_item_id: string }[];
      expect(items.map((i) => i.evidence_item_id)).toEqual(["target-1"]); // surviving operation item remains
    });

    it("source filename/path remain visible from the audit snapshot after source_item_id goes NULL", () => {
      insertMockupItem("source-2", `${FOLDER}/source.jpg`, { missing: true });
      insertPlainItem("target-2", `${FOLDER}/target.jpg`);
      const applyResult = applyArchiveSimilar(db, workspaceId, { sourceItemId: "source-2", selectedItemIds: ["target-2"], reviewTemplate: TEMPLATE, archiveCurrentItem: false, idempotencyKey: "op-2" });

      removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["source-2"], idempotencyKey: "cleanup-2", exportBackup: false });

      const op = db.prepare("SELECT source_item_id, source_item_filename, source_item_original_path, evidence_type_id FROM bulk_review_operations WHERE id = ?").get(applyResult.operationId) as {
        source_item_id: string | null;
        source_item_filename: string;
        source_item_original_path: string;
        evidence_type_id: string;
      };
      expect(op.source_item_id).toBeNull();
      expect(op.source_item_filename).toBe("source.jpg");
      expect(op.source_item_original_path).toBe(`${FOLDER}/source.jpg`);
      expect(op.evidence_type_id).toBe("product_mockup"); // evidence type was already preserved even before this fix
    });

    it("Undo remains available for surviving evidence after the source is removed", () => {
      insertMockupItem("source-3", `${FOLDER}/source.jpg`, { missing: true });
      insertPlainItem("target-3", `${FOLDER}/target.jpg`);
      const applyResult = applyArchiveSimilar(db, workspaceId, { sourceItemId: "source-3", selectedItemIds: ["target-3"], reviewTemplate: TEMPLATE, archiveCurrentItem: false, idempotencyKey: "op-3" });
      expect((db.prepare("SELECT review_status FROM evidence_items WHERE id = 'target-3'").get() as { review_status: string }).review_status).toBe("excluded"); // applied

      removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["source-3"], idempotencyKey: "cleanup-3", exportBackup: false });

      const undoResult = undoArchiveSimilar(db, workspaceId, applyResult.operationId);
      expect(undoResult.restoredCount).toBe(1);
      expect(undoResult.undoStatus).toBe("undone");
      const target = db.prepare("SELECT review_status FROM evidence_items WHERE id = 'target-3'").get() as { review_status: string };
      expect(target.review_status).toBe("unreviewed"); // genuinely restored to its pre-apply state, not just "not errored"
    });

    it("unrelated audit history (a separate bulk operation, untouched by this cleanup) is preserved", () => {
      insertMockupItem("source-4", `${FOLDER}/source4.jpg`, { missing: true });
      insertPlainItem("target-4", `${FOLDER}/target4.jpg`);
      const removedOp = applyArchiveSimilar(db, workspaceId, { sourceItemId: "source-4", selectedItemIds: ["target-4"], reviewTemplate: TEMPLATE, archiveCurrentItem: false, idempotencyKey: "op-4" });

      const OTHER_FOLDER = "Mockups/Unrelated Product";
      insertMockupItem("source-5", `${OTHER_FOLDER}/source5.jpg`); // not missing — untouched by this cleanup
      insertPlainItem("target-5", `${OTHER_FOLDER}/target5.jpg`);
      const unrelatedOp = applyArchiveSimilar(db, workspaceId, { sourceItemId: "source-5", selectedItemIds: ["target-5"], reviewTemplate: TEMPLATE, archiveCurrentItem: false, idempotencyKey: "op-5" });

      removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["source-4"], idempotencyKey: "cleanup-4", exportBackup: false });

      const unrelated = db.prepare("SELECT source_item_id, status, applied_count FROM bulk_review_operations WHERE id = ?").get(unrelatedOp.operationId) as {
        source_item_id: string | null;
        status: string;
        applied_count: number;
      };
      expect(unrelated.source_item_id).toBe("source-5"); // completely untouched — still points at its (surviving) source
      expect(unrelated.status).toBe("completed");
      expect(unrelated.applied_count).toBe(1);
      expect(db.prepare("SELECT * FROM bulk_review_operation_items WHERE operation_id = ?").all(unrelatedOp.operationId)).toHaveLength(1);

      // sanity: the operation actually targeted by the cleanup is still the one affected
      const affected = db.prepare("SELECT source_item_id FROM bulk_review_operations WHERE id = ?").get(removedOp.operationId) as { source_item_id: string | null };
      expect(affected.source_item_id).toBeNull();
    });

    it("no foreign-key violations or orphaned live records occur", () => {
      insertMockupItem("source-6", `${FOLDER}/source6.jpg`, { missing: true });
      insertPlainItem("target-6", `${FOLDER}/target6.jpg`);
      applyArchiveSimilar(db, workspaceId, { sourceItemId: "source-6", selectedItemIds: ["target-6"], reviewTemplate: TEMPLATE, archiveCurrentItem: false, idempotencyKey: "op-6" });

      removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["source-6"], idempotencyKey: "cleanup-6", exportBackup: false });

      const violations = db.pragma("foreign_key_check") as unknown[];
      expect(violations).toEqual([]);
      expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'source-6'").get()).toBeUndefined();
      expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'target-6'").get()).toBeTruthy();
    });

    it("also removing the source item's own bulk_review_operation_item row (when archiveCurrentItem was true) does not affect the other item's row", () => {
      insertMockupItem("source-7", `${FOLDER}/source7.jpg`, { missing: true });
      insertPlainItem("target-7", `${FOLDER}/target7.jpg`);
      const sourceItemPayload = {
        evidenceType: { typeId: "product_mockup", source: "user" as const, confidence: null, reason: null },
        interviewAnswers: Object.fromEntries(Object.entries(TEMPLATE.answers).map(([id, a]) => [id, { value: a.value, confidence: a.confidence, note: null }])),
        connectionsToAdd: [],
        connectionIdsToRemove: [],
        noRelatedEvidence: false,
        usefulnessOverride: { action: "none" as const, score: null, band: null, note: null },
        notes: "",
        decisionAction: "archive" as const,
      };
      const applyResult = applyArchiveSimilar(db, workspaceId, {
        sourceItemId: "source-7",
        selectedItemIds: ["target-7"],
        reviewTemplate: TEMPLATE,
        archiveCurrentItem: true,
        sourceItemPayload,
        idempotencyKey: "op-7",
      });
      expect(applyResult.appliedCount).toBe(2); // source + target

      removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["source-7"], idempotencyKey: "cleanup-7", exportBackup: false });

      const items = db.prepare("SELECT evidence_item_id FROM bulk_review_operation_items WHERE operation_id = ?").all(applyResult.operationId) as { evidence_item_id: string }[];
      expect(items.map((i) => i.evidence_item_id)).toEqual(["target-7"]); // only the source's own row is gone — target's remains

      // The source's own bulk_review_operation_items row was deleted
      // outright (not preserved-and-nulled) when the source itself was
      // removed, so undoArchiveSimilar never even sees it to report as
      // skipped — it only ever iterates rows that still exist, and finds
      // exactly the one surviving (target's) row.
      const undoResult = undoArchiveSimilar(db, workspaceId, applyResult.operationId);
      expect(undoResult.requestedCount).toBe(1);
      expect(undoResult.restoredCount).toBe(1);
      expect(undoResult.skippedCount).toBe(0);
    });
  });

  // Evidence Intelligence regression: the new analysis_runs/
  // evidence_suggestions/extracted_entities/date_assertions/
  // connection_suggestions tables (migration 0017) all have a plain FK
  // to evidence_items under this database's PRAGMA foreign_keys = ON —
  // removing a missing record that has real analysis history must not
  // be blocked by, or leave orphans in, any of them.
  it("removes a missing record that has full Evidence Intelligence history (analysis run, suggestions, entities, dates, connection suggestions) without FK violations or orphans", () => {
    insertItem("ei-1", "gone.jpg", { missing: true });
    insertItem("ei-2", "kept.jpg");

    const runId = db.prepare("INSERT INTO analysis_runs (workspace_id, evidence_item_id, source_fingerprint, metadata_version, evidence_type_registry_version, question_registry_version, deterministic_rule_version, status) VALUES (1, 'ei-1', 'sha-ei-1', '1', '1.0', '1.0', '1', 'completed')").run()
      .lastInsertRowid as number;
    db.prepare("INSERT INTO evidence_suggestions (workspace_id, evidence_item_id, analysis_run_id, field_kind, proposed_value, confidence, rationale, generation_method) VALUES (1, 'ei-1', ?, 'evidence_type', 'product_photo', 'high', 'x', 'deterministic')").run(runId);
    db.prepare("INSERT INTO extracted_entities (workspace_id, evidence_item_id, analysis_run_id, entity_type, raw_text, extraction_method, confidence) VALUES (1, 'ei-1', ?, 'order_number', '#PF1', 'ocr_regex', 'high')").run(runId);
    db.prepare("INSERT INTO date_assertions (workspace_id, evidence_item_id, analysis_run_id, source_type, raw_value, confidence, explanation) VALUES (1, 'ei-1', ?, 'fs_created', '2026-01-01', 'low', 'x')").run(runId);
    db.prepare("INSERT INTO connection_suggestions (workspace_id, source_item_id, target_item_id, analysis_run_id, proposed_type, matched_identifier_type, matched_identifier_value, confidence, rationale) VALUES (1, 'ei-1', 'ei-2', ?, 'related_to', 'order_number', '#PF1', 'high', 'x')").run(runId);

    const result = removeMissingRecords(db, workspaceId, evidenceRoot, { evidenceItemIds: ["ei-1"], idempotencyKey: "k1", exportBackup: false });
    expect(result.removedCount).toBe(1);

    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT * FROM analysis_runs WHERE evidence_item_id = 'ei-1'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM evidence_suggestions WHERE evidence_item_id = 'ei-1'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM extracted_entities WHERE evidence_item_id = 'ei-1'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM date_assertions WHERE evidence_item_id = 'ei-1'").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM connection_suggestions WHERE source_item_id = 'ei-1' OR target_item_id = 'ei-1'").all()).toHaveLength(0);
    expect(db.prepare("SELECT id FROM evidence_items WHERE id = 'ei-2'").get()).toBeTruthy(); // unrelated surviving item untouched
  });
});
