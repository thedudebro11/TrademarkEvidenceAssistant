import type Database from "better-sqlite3";
import type {
  InclusionDecision,
  MissingRecordCandidate,
  MissingRecordDependencyCounts,
  MissingRecordsBackup,
  MissingRecordsBackupEntry,
  MissingRecordsPreviewResponse,
  MissingRecordSkipReasonCode,
  RemovedMissingRecord,
  RemoveMissingRecordsResponse,
  RestoredMissingRecord,
  ReviewStatus,
  SkippedMissingRecord,
  UndoMissingRecordsRemovalResponse,
} from "@trademark-evidence-assistant/shared";
import { MISSING_RECORD_SKIP_REASON_LABELS } from "@trademark-evidence-assistant/shared";
import { classifyFileAvailability } from "../engines/fileAvailability.js";
import { resolveSafePath } from "../security/pathGuard.js";

/**
 * "Remove Missing Records" — permanently deletes evidence records (and
 * every dependent row this schema actually has — see the delete-order
 * comment on `deleteDependentRows`) whose original file the server
 * independently reconfirms is missing, immediately before mutation.
 * Never trusts the client's `missing_since` read at preview time; never
 * touches a physical file (every operation here is `evidence_items` and
 * its dependents only). Modeled on bulkReviewService.ts's Archive
 * Similar apply/undo: one audit envelope row inserted *outside* the
 * mutation transaction (so a failure is still traceable), idempotency
 * via a unique (workspace_id, idempotency_key), and a real
 * database-backed Undo — but unlike Archive Similar, this deletes the
 * evidence_items row itself, so Undo must reconstruct it from a stored
 * snapshot rather than re-reading "before" state off a row that no
 * longer exists.
 */

export class MissingRecordsValidationError extends Error {}
export class MissingRecordsOperationNotFoundError extends Error {}

interface EvidenceItemRow {
  id: string;
  workspace_id: number;
  original_path: string;
  original_filename: string;
  extension: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  fs_modified_at: string | null;
  missing_since: string | null;
  review_status: string;
  inclusion_decision: string | null;
  notes: string | null;
  evidence_type_id: string | null;
}

function folderOf(originalPath: string): string {
  const idx = originalPath.lastIndexOf("/");
  return idx === -1 ? "" : originalPath.slice(0, idx);
}

function getMissingRows(db: Database.Database, workspaceId: number): EvidenceItemRow[] {
  return db
    .prepare(
      `SELECT id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256,
              fs_modified_at, missing_since, review_status, inclusion_decision, notes, evidence_type_id
       FROM evidence_items WHERE workspace_id = ? AND missing_since IS NOT NULL`,
    )
    .all(workspaceId) as EvidenceItemRow[];
}

function getDependencyCounts(db: Database.Database, itemId: string): MissingRecordDependencyCounts {
  const answers = (db.prepare("SELECT COUNT(*) AS c FROM review_answers WHERE evidence_item_id = ?").get(itemId) as { c: number }).c;
  const connOut = (db.prepare("SELECT COUNT(*) AS c FROM connections WHERE source_item_id = ?").get(itemId) as { c: number }).c;
  const connIn = (db.prepare("SELECT COUNT(*) AS c FROM connections WHERE target_item_id = ?").get(itemId) as { c: number }).c;
  const dupes = (db.prepare("SELECT COUNT(*) AS c FROM duplicates WHERE evidence_item_id = ?").get(itemId) as { c: number }).c;
  const heic = db.prepare("SELECT 1 FROM heic_previews WHERE evidence_item_id = ?").get(itemId) as unknown | undefined;
  const bulkRefs =
    (db.prepare("SELECT COUNT(*) AS c FROM bulk_review_operation_items WHERE evidence_item_id = ?").get(itemId) as { c: number }).c +
    (db.prepare("SELECT COUNT(*) AS c FROM bulk_review_operations WHERE source_item_id = ?").get(itemId) as { c: number }).c;
  const exportRefs = (db.prepare("SELECT COUNT(*) AS c FROM export_items WHERE evidence_item_id = ?").get(itemId) as { c: number }).c;
  const notes = db.prepare("SELECT notes FROM evidence_items WHERE id = ?").get(itemId) as { notes: string | null } | undefined;

  return {
    reviewAnswers: answers,
    connectionsOutgoing: connOut,
    connectionsIncoming: connIn,
    duplicateMemberships: dupes,
    hasHeicPreview: heic !== undefined,
    hasNotes: Boolean(notes?.notes && notes.notes.trim().length > 0),
    bulkOperationReferences: bulkRefs,
    exportReferences: exportRefs,
  };
}

const REVIEWED_STATUSES = new Set(["reviewed", "needs_follow_up", "excluded"]);

function computeHasReviewedWork(row: EvidenceItemRow, deps: MissingRecordDependencyCounts): boolean {
  return (
    REVIEWED_STATUSES.has(row.review_status) ||
    row.inclusion_decision !== null ||
    row.evidence_type_id !== null ||
    deps.reviewAnswers > 0 ||
    deps.hasNotes ||
    deps.connectionsOutgoing + deps.connectionsIncoming > 0
  );
}

function toCandidate(row: EvidenceItemRow, availabilityReasonCode: MissingRecordCandidate["availabilityReasonCode"], db: Database.Database): MissingRecordCandidate {
  const deps = getDependencyCounts(db, row.id);
  return {
    evidenceItemId: row.id,
    filename: row.original_filename,
    originalPath: row.original_path,
    folderPath: folderOf(row.original_path),
    evidenceTypeId: row.evidence_type_id,
    reviewStatus: row.review_status as ReviewStatus,
    inclusionDecision: row.inclusion_decision as InclusionDecision | null,
    connectionsCount: deps.connectionsOutgoing + deps.connectionsIncoming,
    notesCount: deps.hasNotes ? 1 : 0,
    answersCount: deps.reviewAnswers,
    fileSize: row.file_size,
    lastKnownModifiedAt: row.fs_modified_at,
    missingSince: row.missing_since,
    availabilityReasonCode,
    dependencyCounts: deps,
    hasReviewedWork: computeHasReviewedWork(row, deps),
  };
}

/**
 * Read-only. Every row the last scan flagged `missing_since IS NOT NULL`
 * is rechecked fresh via `classifyFileAvailability` — a row whose fresh
 * check now comes back `available` (the file reappeared since that
 * scan) is silently excluded from both lists rather than shown as
 * either kind of "missing"; the existing rescan flow is what clears its
 * stale `missing_since`, this endpoint never writes.
 */
export function previewMissingRecords(db: Database.Database, workspaceId: number, evidenceRoot: string): MissingRecordsPreviewResponse {
  const rows = getMissingRows(db, workspaceId);
  const confidentlyMissing: MissingRecordCandidate[] = [];
  const uncertain: MissingRecordCandidate[] = [];

  for (const row of rows) {
    const absolutePath = resolveSafePath(evidenceRoot, row.original_path);
    const availability = classifyFileAvailability(evidenceRoot, absolutePath);
    if (availability.status === "available") continue;
    const candidate = toCandidate(row, availability.reasonCode!, db);
    if (availability.status === "missing") {
      confidentlyMissing.push(candidate);
    } else {
      uncertain.push(candidate);
    }
  }

  return { confidentlyMissing, uncertain };
}

interface EvidenceItemSnapshot {
  evidenceItem: Record<string, unknown>;
  fileMetadata: Record<string, unknown> | null;
  reviewAnswers: Record<string, unknown>[];
  connectionsOutgoing: Record<string, unknown>[];
  connectionsIncoming: Record<string, unknown>[];
  duplicateGroups: string[]; // sha256 values this item belonged to
  heicPreview: Record<string, unknown> | null;
}

function snapshotEvidenceItem(db: Database.Database, itemId: string): EvidenceItemSnapshot {
  const evidenceItem = db.prepare("SELECT * FROM evidence_items WHERE id = ?").get(itemId) as Record<string, unknown>;
  const fileMetadata = (db.prepare("SELECT * FROM file_metadata WHERE evidence_item_id = ?").get(itemId) as Record<string, unknown> | undefined) ?? null;
  const reviewAnswers = db.prepare("SELECT * FROM review_answers WHERE evidence_item_id = ?").all(itemId) as Record<string, unknown>[];
  const connectionsOutgoing = db.prepare("SELECT * FROM connections WHERE source_item_id = ?").all(itemId) as Record<string, unknown>[];
  const connectionsIncoming = db.prepare("SELECT * FROM connections WHERE target_item_id = ?").all(itemId) as Record<string, unknown>[];
  const duplicateGroups = (db.prepare("SELECT DISTINCT sha256 FROM duplicates WHERE evidence_item_id = ?").all(itemId) as { sha256: string }[]).map((r) => r.sha256);
  const heicPreview = (db.prepare("SELECT * FROM heic_previews WHERE evidence_item_id = ?").get(itemId) as Record<string, unknown> | undefined) ?? null;
  return { evidenceItem, fileMetadata, reviewAnswers, connectionsOutgoing, connectionsIncoming, duplicateGroups, heicPreview };
}

/**
 * Deletes every row this schema actually has that references
 * `itemId` (inspected directly from the migrations — no table name
 * guessed), in an order that satisfies this database's `PRAGMA
 * foreign_keys = ON` (child rows before the evidence_items row itself).
 * `duplicates` is additionally *dissolved*, not just trimmed: a
 * "duplicate group" only means anything with 2+ members, so after
 * removing this item's own row, any group left with fewer than 2 rows
 * is deleted entirely rather than kept as a meaningless single-member
 * group — matching how scanService.ts's rebuildDuplicates only ever
 * creates groups with `HAVING COUNT(*) > 1` in the first place.
 *
 * `bulk_review_operations` where this item was the *source* is
 * deliberately never deleted, and neither are its
 * `bulk_review_operation_items` rows for every OTHER item that
 * operation touched — only this one item's own row there (if any) is
 * removed, by the plain `evidence_item_id` delete above. Deleting the
 * whole operation merely because its source went missing would erase
 * audit and Undo history for unrelated, still-existing evidence items
 * that operation also applied to; see migration 0015's doc comment.
 * Instead `source_item_id` (now nullable, `ON DELETE SET NULL`) is
 * cleared and a filename/path snapshot is written in its place, so the
 * operation stays understandable in the audit trail without pointing at
 * a row that no longer exists.
 */
function deleteDependentRows(db: Database.Database, itemId: string, snapshot: EvidenceItemSnapshot): void {
  db.prepare("DELETE FROM file_metadata WHERE evidence_item_id = ?").run(itemId);
  db.prepare("DELETE FROM review_answers WHERE evidence_item_id = ?").run(itemId);
  db.prepare("DELETE FROM connections WHERE source_item_id = ? OR target_item_id = ?").run(itemId, itemId);
  db.prepare("DELETE FROM heic_previews WHERE evidence_item_id = ?").run(itemId);
  db.prepare("DELETE FROM export_items WHERE evidence_item_id = ?").run(itemId);
  db.prepare("DELETE FROM bulk_review_operation_items WHERE evidence_item_id = ?").run(itemId);

  // Evidence Intelligence (migration 0017) — child tables before
  // analysis_runs itself, since each references analysis_run_id.
  // connection_suggestions is keyed by source_item_id/target_item_id
  // (this item can be either end of a proposed connection), the rest
  // by evidence_item_id directly. Deleting this item's own staged
  // suggestions is safe regardless of state (proposed/accepted/
  // rejected/etc) — a *confirmed* value from an accepted suggestion
  // already lives in evidence_items/review_answers/connections, which
  // this same function deletes separately above; nothing here is the
  // sole record of a confirmed fact.
  db.prepare("DELETE FROM connection_suggestions WHERE source_item_id = ? OR target_item_id = ?").run(itemId, itemId);
  db.prepare("DELETE FROM evidence_suggestions WHERE evidence_item_id = ?").run(itemId);
  db.prepare("DELETE FROM extracted_entities WHERE evidence_item_id = ?").run(itemId);
  db.prepare("DELETE FROM date_assertions WHERE evidence_item_id = ?").run(itemId);
  db.prepare("DELETE FROM analysis_runs WHERE evidence_item_id = ?").run(itemId);

  db.prepare(
    `UPDATE bulk_review_operations
       SET source_item_id = NULL, source_item_filename = ?, source_item_original_path = ?
     WHERE source_item_id = ?`,
  ).run(snapshot.evidenceItem.original_filename as string, snapshot.evidenceItem.original_path as string, itemId);

  db.prepare("DELETE FROM duplicates WHERE evidence_item_id = ?").run(itemId);
  const workspaceId = snapshot.evidenceItem.workspace_id as number;
  for (const sha256 of snapshot.duplicateGroups) {
    const remaining = (db.prepare("SELECT COUNT(*) AS c FROM duplicates WHERE workspace_id = ? AND sha256 = ?").get(workspaceId, sha256) as { c: number }).c;
    if (remaining < 2) {
      db.prepare("DELETE FROM duplicates WHERE workspace_id = ? AND sha256 = ?").run(workspaceId, sha256);
    }
  }
}

export interface RemoveMissingRecordsParams {
  evidenceItemIds: string[];
  idempotencyKey: string;
  exportBackup: boolean;
  initiatedBy?: string;
}

interface OperationRow {
  id: number;
  requested_count: number;
  removed_count: number;
  skipped_count: number;
  failed_count: number;
  status: string;
  backup_exported: number;
}

function buildResponseFromExistingOperation(db: Database.Database, operationId: number): RemoveMissingRecordsResponse {
  const op = db
    .prepare("SELECT id, requested_count, removed_count, skipped_count, failed_count, status, backup_exported FROM missing_records_cleanup_operations WHERE id = ?")
    .get(operationId) as OperationRow;
  const removedRows = db
    .prepare("SELECT evidence_item_id, original_filename FROM missing_records_cleanup_items WHERE operation_id = ? AND result = 'removed'")
    .all(operationId) as { evidence_item_id: string; original_filename: string }[];
  const skippedRows = db
    .prepare("SELECT evidence_item_id, original_filename, skip_reason_code FROM missing_records_cleanup_items WHERE operation_id = ? AND result = 'skipped'")
    .all(operationId) as { evidence_item_id: string; original_filename: string; skip_reason_code: MissingRecordSkipReasonCode }[];

  return {
    operationId: op.id,
    requestedCount: op.requested_count,
    removedCount: op.removed_count,
    skippedCount: op.skipped_count,
    failedCount: op.failed_count,
    removed: removedRows.map((r) => ({ evidenceItemId: r.evidence_item_id, filename: r.original_filename })),
    skipped: skippedRows.map((r) => ({ evidenceItemId: r.evidence_item_id, filename: r.original_filename, reasonCode: r.skip_reason_code, reasonLabel: MISSING_RECORD_SKIP_REASON_LABELS[r.skip_reason_code] })),
    status: op.status as RemoveMissingRecordsResponse["status"],
    backup: null, // the backup JSON itself is never persisted, only whether one was generated (backup_exported) — see the doc comment on removeMissingRecords for why
  };
}

function buildBackupEntry(snapshot: EvidenceItemSnapshot): MissingRecordsBackupEntry {
  const item = snapshot.evidenceItem;
  return {
    evidenceItemId: item.id as string,
    originalFilename: item.original_filename as string,
    originalPath: item.original_path as string,
    evidenceTypeId: (item.evidence_type_id as string | null) ?? null,
    reviewStatus: item.review_status as ReviewStatus,
    inclusionDecision: (item.inclusion_decision as InclusionDecision | null) ?? null,
    notes: (item.notes as string | null) ?? null,
    metadata: snapshot.fileMetadata ? { width: (snapshot.fileMetadata.width as number | null) ?? null, height: (snapshot.fileMetadata.height as number | null) ?? null } : null,
    answers: snapshot.reviewAnswers.map((a) => ({
      questionId: a.question_id as string,
      value: a.value as string,
      source: a.source as string,
      confidence: (a.confidence as string | null) ?? null,
      note: (a.note as string | null) ?? null,
    })),
    connections: [
      ...snapshot.connectionsOutgoing.map((c) => ({ direction: "outgoing" as const, otherEvidenceItemId: c.target_item_id as string, type: c.type as string, explanation: c.explanation as string, confidence: (c.confidence as string | null) ?? null })),
      ...snapshot.connectionsIncoming.map((c) => ({ direction: "incoming" as const, otherEvidenceItemId: c.source_item_id as string, type: c.type as string, explanation: c.explanation as string, confidence: (c.confidence as string | null) ?? null })),
    ],
  };
}

/**
 * Permanently removes the requested evidence records, after
 * independently reconfirming eligibility for every one of them against
 * the *current* database and filesystem state — see `checkEligibility`.
 * One transaction for the whole batch (never one request per item).
 * The audit envelope row is inserted and (on success or failure)
 * finalized outside/after that transaction, exactly like
 * bulkReviewService.applyArchiveSimilar, so a rolled-back mutation still
 * leaves an accurate "failed" audit record rather than none at all.
 */
export function removeMissingRecords(db: Database.Database, workspaceId: number, evidenceRoot: string, params: RemoveMissingRecordsParams): RemoveMissingRecordsResponse {
  const existingOp = db
    .prepare("SELECT id FROM missing_records_cleanup_operations WHERE workspace_id = ? AND idempotency_key = ?")
    .get(workspaceId, params.idempotencyKey) as { id: number } | undefined;
  if (existingOp) {
    return buildResponseFromExistingOperation(db, existingOp.id);
  }

  if (params.evidenceItemIds.length === 0) {
    throw new MissingRecordsValidationError("evidenceItemIds must not be empty");
  }

  const requestedCount = params.evidenceItemIds.length;
  const insertOp = db
    .prepare(
      `INSERT INTO missing_records_cleanup_operations (workspace_id, status, idempotency_key, initiated_by, requested_count)
       VALUES (?, 'in_progress', ?, ?, ?)`,
    )
    .run(workspaceId, params.idempotencyKey, params.initiatedBy ?? "user", requestedCount);
  const operationId = Number(insertOp.lastInsertRowid);

  const toRemove: { row: EvidenceItemRow; snapshot: EvidenceItemSnapshot }[] = [];
  const skipped: SkippedMissingRecord[] = [];

  for (const itemId of params.evidenceItemIds) {
    const row = db.prepare("SELECT * FROM evidence_items WHERE id = ? AND workspace_id = ?").get(itemId, workspaceId) as EvidenceItemRow | undefined;
    if (!row) {
      skipped.push({ evidenceItemId: itemId, filename: itemId, reasonCode: "ITEM_NOT_FOUND", reasonLabel: MISSING_RECORD_SKIP_REASON_LABELS.ITEM_NOT_FOUND });
      continue;
    }
    if (row.missing_since === null) {
      skipped.push({ evidenceItemId: itemId, filename: row.original_filename, reasonCode: "NOT_MISSING", reasonLabel: MISSING_RECORD_SKIP_REASON_LABELS.NOT_MISSING });
      continue;
    }
    const absolutePath = resolveSafePath(evidenceRoot, row.original_path);
    const availability = classifyFileAvailability(evidenceRoot, absolutePath);
    if (availability.status === "available") {
      skipped.push({ evidenceItemId: itemId, filename: row.original_filename, reasonCode: "FILE_REAPPEARED", reasonLabel: MISSING_RECORD_SKIP_REASON_LABELS.FILE_REAPPEARED });
      continue;
    }
    if (availability.status !== "missing") {
      skipped.push({ evidenceItemId: itemId, filename: row.original_filename, reasonCode: availability.reasonCode!, reasonLabel: MISSING_RECORD_SKIP_REASON_LABELS[availability.reasonCode!] });
      continue;
    }
    toRemove.push({ row, snapshot: snapshotEvidenceItem(db, itemId) });
  }

  try {
    const removeMutations = db.transaction(() => {
      const removed: RemovedMissingRecord[] = [];
      for (const { row, snapshot } of toRemove) {
        const deps = getDependencyCounts(db, row.id);
        deleteDependentRows(db, row.id, snapshot);
        db.prepare("DELETE FROM evidence_items WHERE id = ? AND workspace_id = ?").run(row.id, workspaceId);

        db.prepare(
          `INSERT INTO missing_records_cleanup_items
             (operation_id, evidence_item_id, original_filename, original_path, evidence_type_id,
              prior_review_status, prior_inclusion_decision, dependency_counts_json, result, snapshot_json, removed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'removed', ?, datetime('now'))`,
        ).run(operationId, row.id, row.original_filename, row.original_path, row.evidence_type_id, row.review_status, row.inclusion_decision, JSON.stringify(deps), JSON.stringify(snapshot));

        removed.push({ evidenceItemId: row.id, filename: row.original_filename });
      }

      for (const s of skipped) {
        db.prepare(
          `INSERT INTO missing_records_cleanup_items
             (operation_id, evidence_item_id, original_filename, original_path, result, skip_reason_code)
           VALUES (?, ?, ?, ?, 'skipped', ?)`,
        ).run(operationId, s.evidenceItemId, s.filename, s.filename, s.reasonCode);
      }

      return removed;
    });

    const removed = removeMutations();
    const status: RemoveMissingRecordsResponse["status"] = skipped.length > 0 ? "partially_completed" : "completed";

    let backup: MissingRecordsBackup | null = null;
    if (params.exportBackup && removed.length > 0) {
      backup = {
        generatedAt: new Date().toISOString(),
        workspaceName: "", // filled in by the route, which already has the resolved workspace name
        operationId,
        records: toRemove.map((r) => buildBackupEntry(r.snapshot)),
      };
    }

    db.prepare("UPDATE missing_records_cleanup_operations SET status = ?, completed_at = datetime('now'), removed_count = ?, skipped_count = ?, backup_exported = ? WHERE id = ?").run(
      status,
      removed.length,
      skipped.length,
      backup ? 1 : 0,
      operationId,
    );

    return { operationId, requestedCount, removedCount: removed.length, skippedCount: skipped.length, failedCount: 0, removed, skipped, status, backup };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE missing_records_cleanup_operations SET status = 'failed', completed_at = datetime('now'), error_summary = ? WHERE id = ?").run(message, operationId);
    return { operationId, requestedCount, removedCount: 0, skippedCount: skipped.length, failedCount: toRemove.length, removed: [], skipped, status: "failed", backup: null };
  }
}

interface CleanupItemRow {
  id: number;
  evidence_item_id: string;
  original_filename: string;
  snapshot_json: string | null;
}

function buildUndoResponseFromOperation(db: Database.Database, operationId: number): UndoMissingRecordsRemovalResponse {
  const op = db.prepare("SELECT restored_count, restore_skipped_count, undo_status FROM missing_records_cleanup_operations WHERE id = ?").get(operationId) as {
    restored_count: number;
    restore_skipped_count: number;
    undo_status: string;
  };
  const restoredRows = db
    .prepare("SELECT evidence_item_id, original_filename FROM missing_records_cleanup_items WHERE operation_id = ? AND restore_result = 'restored'")
    .all(operationId) as { evidence_item_id: string; original_filename: string }[];
  const skippedRows = db
    .prepare("SELECT evidence_item_id, original_filename, restore_skip_reason FROM missing_records_cleanup_items WHERE operation_id = ? AND restore_result = 'skipped'")
    .all(operationId) as { evidence_item_id: string; original_filename: string; restore_skip_reason: MissingRecordSkipReasonCode }[];

  return {
    operationId,
    requestedCount: op.restored_count + op.restore_skipped_count,
    restoredCount: op.restored_count,
    skippedCount: op.restore_skipped_count,
    restored: restoredRows.map((r) => ({ evidenceItemId: r.evidence_item_id, filename: r.original_filename })),
    skipped: skippedRows.map((r) => ({ evidenceItemId: r.evidence_item_id, filename: r.original_filename, reasonCode: r.restore_skip_reason, reasonLabel: MISSING_RECORD_SKIP_REASON_LABELS[r.restore_skip_reason] })),
    undoStatus: op.undo_status as UndoMissingRecordsRemovalResponse["undoStatus"],
  };
}

function insertFromSnapshotRow(db: Database.Database, table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).run(...columns.map((c) => row[c]));
}

/** Drops an AUTOINCREMENT `id` key entirely (rather than setting it `undefined`, which better-sqlite3's bind rejects) so the restoring INSERT lets SQLite assign a fresh one. */
function withoutAutoIncrementId(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = row;
  return rest;
}

/**
 * Restores every still-restorable removed record from its stored
 * snapshot — for real, in the database. "Restorable" means: no row with
 * that id exists again already (e.g. a rescan recreated it after the
 * file reappeared — this app derives evidence item ids deterministically
 * from workspace + path, so that's a real possible collision, not
 * hypothetical). Idempotent — undoing an already-undone operation just
 * re-returns the first outcome. Connections are restored only when
 * *both* endpoints exist after this item's own row is reinserted — the
 * other item may itself have been deleted by this same cleanup (in a
 * different, non-undone operation) or by ordinary review since. Never
 * recreates the physical source file — restores the application record
 * only.
 *
 * Known limitation: if two connected items were removed via two
 * *separate* operations (two different `removeMissingRecords` calls,
 * each with its own idempotency key), the connection cannot be
 * restored even after undoing both — whichever item was removed first
 * deletes the shared `connections` row outright, so the item removed
 * second never had it in its own snapshot to restore from. This
 * service never searches other operations' snapshots to recover it.
 * The feature's own UI (MissingRecordsModal.tsx) never produces this
 * shape — every selected item is always removed in one batched
 * request — so this only matters for a direct API caller that chooses
 * to call `removeMissingRecords` once per item.
 */
export function undoMissingRecordsRemoval(db: Database.Database, workspaceId: number, operationId: number): UndoMissingRecordsRemovalResponse {
  const op = db.prepare("SELECT id, undone_at FROM missing_records_cleanup_operations WHERE id = ? AND workspace_id = ?").get(operationId, workspaceId) as
    | { id: number; undone_at: string | null }
    | undefined;
  if (!op) {
    throw new MissingRecordsOperationNotFoundError(`Cleanup operation ${operationId} not found in this workspace`);
  }
  if (op.undone_at) {
    return buildUndoResponseFromOperation(db, operationId);
  }

  const items = db
    .prepare("SELECT id, evidence_item_id, original_filename, snapshot_json FROM missing_records_cleanup_items WHERE operation_id = ? AND result = 'removed'")
    .all(operationId) as CleanupItemRow[];

  const restored: RestoredMissingRecord[] = [];
  const skipped: SkippedMissingRecord[] = [];

  const run = db.transaction(() => {
    for (const item of items) {
      const alreadyExists = db.prepare("SELECT id FROM evidence_items WHERE id = ?").get(item.evidence_item_id);
      if (alreadyExists) {
        skipped.push({ evidenceItemId: item.evidence_item_id, filename: item.original_filename, reasonCode: "FILE_REAPPEARED", reasonLabel: "A record for this file already exists (it was likely restored by a rescan)" });
        db.prepare("UPDATE missing_records_cleanup_items SET restore_result = 'skipped', restore_skip_reason = 'FILE_REAPPEARED', restored_at = datetime('now') WHERE id = ?").run(item.id);
        continue;
      }
      if (!item.snapshot_json) {
        skipped.push({ evidenceItemId: item.evidence_item_id, filename: item.original_filename, reasonCode: "ITEM_NOT_FOUND", reasonLabel: MISSING_RECORD_SKIP_REASON_LABELS.ITEM_NOT_FOUND });
        db.prepare("UPDATE missing_records_cleanup_items SET restore_result = 'skipped', restore_skip_reason = 'ITEM_NOT_FOUND', restored_at = datetime('now') WHERE id = ?").run(item.id);
        continue;
      }

      const snapshot = JSON.parse(item.snapshot_json) as EvidenceItemSnapshot;
      insertFromSnapshotRow(db, "evidence_items", snapshot.evidenceItem);
      if (snapshot.fileMetadata) insertFromSnapshotRow(db, "file_metadata", snapshot.fileMetadata);
      for (const answer of snapshot.reviewAnswers) insertFromSnapshotRow(db, "review_answers", withoutAutoIncrementId(answer));
      if (snapshot.heicPreview) insertFromSnapshotRow(db, "heic_previews", snapshot.heicPreview);

      for (const conn of [...snapshot.connectionsOutgoing, ...snapshot.connectionsIncoming]) {
        const sourceId = conn.source_item_id as string;
        const targetId = conn.target_item_id as string;
        const otherId = sourceId === item.evidence_item_id ? targetId : sourceId;
        const otherExists = db.prepare("SELECT id FROM evidence_items WHERE id = ?").get(otherId);
        if (!otherExists) continue; // the other item is gone — this connection cannot be restored, and that's correct, not an error
        const alreadyThere = db.prepare("SELECT id FROM connections WHERE source_item_id = ? AND target_item_id = ? AND type = ?").get(sourceId, targetId, conn.type as string);
        if (alreadyThere) continue;
        insertFromSnapshotRow(db, "connections", withoutAutoIncrementId(conn));
      }

      for (const sha256 of snapshot.duplicateGroups) {
        const alreadyThere = db.prepare("SELECT id FROM duplicates WHERE workspace_id = ? AND sha256 = ? AND evidence_item_id = ?").get(workspaceId, sha256, item.evidence_item_id);
        if (!alreadyThere) {
          db.prepare("INSERT INTO duplicates (workspace_id, sha256, evidence_item_id) VALUES (?, ?, ?)").run(workspaceId, sha256, item.evidence_item_id);
        }
      }

      restored.push({ evidenceItemId: item.evidence_item_id, filename: item.original_filename });
      db.prepare("UPDATE missing_records_cleanup_items SET restore_result = 'restored', restored_at = datetime('now') WHERE id = ?").run(item.id);
    }

    const undoStatus: UndoMissingRecordsRemovalResponse["undoStatus"] = skipped.length === 0 ? "undone" : "partially_undone";
    db.prepare("UPDATE missing_records_cleanup_operations SET undone_at = datetime('now'), undo_status = ?, restored_count = ?, restore_skipped_count = ? WHERE id = ?").run(
      undoStatus,
      restored.length,
      skipped.length,
      operationId,
    );
    return undoStatus;
  });

  const undoStatus = run();

  return { operationId, requestedCount: items.length, restoredCount: restored.length, skippedCount: skipped.length, restored, skipped, undoStatus };
}
