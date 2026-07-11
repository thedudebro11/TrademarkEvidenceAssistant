import type Database from "better-sqlite3";
import type {
  EvidenceItemDetail,
  FileRole,
  InclusionDecision,
  ReviewAnswer,
  ReviewDecisionAction,
  SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import { FILE_ROLES, SUGGESTION_CONFIDENCES } from "@trademark-evidence-assistant/shared";
import { computeProgress, pickNextUnreviewed, pickPrevious } from "../engines/reviewQueueEngine.js";
import type { QueueItem, ReviewProgressCounts } from "../engines/reviewQueueEngine.js";
import { resolveSafePath, PathTraversalError } from "../security/pathGuard.js";
import { getConnectionsForItem } from "./connectionService.js";
import { getUsefulness } from "./scoringService.js";

interface EvidenceItemRow {
  id: string;
  original_path: string;
  original_filename: string;
  extension: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  discovered_at: string;
  fs_created_at: string | null;
  fs_modified_at: string | null;
  missing_since: string | null;
  review_status: string;
  inclusion_decision: string | null;
  notes: string | null;
  notes_updated_at: string | null;
  decided_at: string | null;
  file_role: string | null;
}

/**
 * Maps a review decision action (the verb the UI sends) to the stored
 * review_status + inclusion_decision it produces. Business rule lives
 * exactly once, here — see migration 0003_review.sql for the full
 * spec-05-vs-USER_JOURNEY vocabulary reconciliation this reflects.
 */
function decisionToState(
  action: ReviewDecisionAction,
): { reviewStatus: string; inclusionDecision: InclusionDecision | null } {
  switch (action) {
    case "include":
      return { reviewStatus: "reviewed", inclusionDecision: "include" };
    case "maybe":
      return { reviewStatus: "reviewed", inclusionDecision: "maybe" };
    case "follow_up":
      return { reviewStatus: "needs_follow_up", inclusionDecision: null };
    case "archive":
      return { reviewStatus: "excluded", inclusionDecision: "not_useful" };
  }
}

function mapRow(db: Database.Database, row: EvidenceItemRow): EvidenceItemDetail {
  const metadataRow = db
    .prepare("SELECT width, height, page_count FROM file_metadata WHERE evidence_item_id = ?")
    .get(row.id) as { width: number | null; height: number | null; page_count: number | null } | undefined;

  const duplicateRows = db
    .prepare(
      `SELECT ei.id AS evidence_item_id, ei.original_path
       FROM duplicates d
       JOIN evidence_items ei ON ei.id = d.evidence_item_id
       WHERE d.sha256 = ? AND d.evidence_item_id != ?
       ORDER BY ei.original_path`,
    )
    .all(row.sha256, row.id) as { evidence_item_id: string; original_path: string }[];

  const answerRows = db
    .prepare(
      "SELECT question_id, value, source, confidence, note, answered_at FROM review_answers WHERE evidence_item_id = ?",
    )
    .all(row.id) as {
    question_id: string;
    value: string;
    source: string;
    confidence: string | null;
    note: string | null;
    answered_at: string;
  }[];

  const answers = answerRows.map(
    (a): ReviewAnswer => ({
      questionId: a.question_id,
      value: a.value,
      source: a.source,
      confidence: a.confidence as SuggestionConfidence | null,
      note: a.note,
      answeredAt: a.answered_at,
    }),
  );
  const connections = getConnectionsForItem(db, row.id);
  const fileRole = row.file_role as FileRole | null;

  return {
    id: row.id,
    originalPath: row.original_path,
    originalFilename: row.original_filename,
    extension: row.extension,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    sha256: row.sha256,
    discoveredAt: row.discovered_at,
    fsCreatedAt: row.fs_created_at,
    fsModifiedAt: row.fs_modified_at,
    missingSince: row.missing_since,
    reviewStatus: row.review_status as EvidenceItemDetail["reviewStatus"],
    inclusionDecision: row.inclusion_decision as InclusionDecision | null,
    notes: row.notes,
    notesUpdatedAt: row.notes_updated_at,
    decidedAt: row.decided_at,
    metadata: metadataRow
      ? { width: metadataRow.width, height: metadataRow.height, pageCount: metadataRow.page_count }
      : null,
    duplicates: duplicateRows.map((d) => ({
      evidenceItemId: d.evidence_item_id,
      originalPath: d.original_path,
    })),
    fileRole,
    answers,
    connections,
    usefulness: getUsefulness(
      db,
      row.id,
      answers,
      fileRole,
      duplicateRows.length > 0,
      Boolean(row.notes && row.notes.trim()),
      connections.map((c) => c.type),
    ),
  };
}

const ITEM_COLUMNS = `id, original_path, original_filename, extension, mime_type, file_size, sha256,
  discovered_at, fs_created_at, fs_modified_at, missing_since, review_status,
  inclusion_decision, notes, notes_updated_at, decided_at, file_role`;

function getOrderedQueueItems(db: Database.Database, workspaceId: number): QueueItem[] {
  const rows = db
    .prepare("SELECT id, review_status FROM evidence_items WHERE workspace_id = ? ORDER BY original_path")
    .all(workspaceId) as { id: string; review_status: string }[];
  return rows.map((r) => ({ id: r.id, reviewStatus: r.review_status as QueueItem["reviewStatus"] }));
}

export function getProgress(db: Database.Database, workspaceId: number): ReviewProgressCounts {
  const rows = db
    .prepare("SELECT review_status FROM evidence_items WHERE workspace_id = ?")
    .all(workspaceId) as { review_status: string }[];
  return computeProgress(rows.map((r) => r.review_status as QueueItem["reviewStatus"]));
}

export function getItemDetail(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
): EvidenceItemDetail | null {
  const row = db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM evidence_items WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, itemId) as EvidenceItemRow | undefined;
  return row ? mapRow(db, row) : null;
}

export function getNextItem(
  db: Database.Database,
  workspaceId: number,
  currentId: string | null,
): EvidenceItemDetail | null {
  const queue = getOrderedQueueItems(db, workspaceId);
  const nextId = pickNextUnreviewed(queue, currentId);
  return nextId ? getItemDetail(db, workspaceId, nextId) : null;
}

export function getPreviousItem(
  db: Database.Database,
  workspaceId: number,
  currentId: string,
): EvidenceItemDetail | null {
  const queue = getOrderedQueueItems(db, workspaceId);
  const previousId = pickPrevious(queue, currentId);
  return previousId ? getItemDetail(db, workspaceId, previousId) : null;
}

/** Records a review decision. Throws if the item does not belong to the workspace. */
export function recordDecision(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  action: ReviewDecisionAction,
): EvidenceItemDetail {
  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new Error(`Evidence item ${itemId} not found in this workspace`);
  }

  const { reviewStatus, inclusionDecision } = decisionToState(action);
  db.prepare(
    `UPDATE evidence_items
     SET review_status = ?, inclusion_decision = ?, decided_at = datetime('now')
     WHERE id = ?`,
  ).run(reviewStatus, inclusionDecision, itemId);

  return getItemDetail(db, workspaceId, itemId)!;
}

/** Autosaves free-text notes without touching review_status/inclusion_decision. */
export function saveNotes(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  notes: string,
): { notesUpdatedAt: string } {
  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new Error(`Evidence item ${itemId} not found in this workspace`);
  }

  db.prepare("UPDATE evidence_items SET notes = ?, notes_updated_at = datetime('now') WHERE id = ?").run(
    notes,
    itemId,
  );

  const row = db.prepare("SELECT notes_updated_at FROM evidence_items WHERE id = ?").get(itemId) as {
    notes_updated_at: string;
  };
  return { notesUpdatedAt: row.notes_updated_at };
}

export type ResolvedItemFile =
  | { kind: "ok"; absolutePath: string; mimeType: string }
  | { kind: "missing" }
  | { kind: "not_found" };

/**
 * Resolves an Evidence Item's original file for read-only preview
 * streaming. Every path is validated against the evidence root via
 * resolveSafePath before any filesystem access — see
 * docs/ARCHITECTURE_CONSTITUTION.md Security boundary and
 * docs/RISKS.md #1.
 */
export function resolveItemFile(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  evidenceRoot: string,
): ResolvedItemFile {
  const row = db
    .prepare("SELECT original_path, mime_type, missing_since FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId) as { original_path: string; mime_type: string; missing_since: string | null } | undefined;

  if (!row) {
    return { kind: "not_found" };
  }
  if (row.missing_since !== null) {
    return { kind: "missing" };
  }

  try {
    const absolutePath = resolveSafePath(evidenceRoot, row.original_path);
    return { kind: "ok", absolutePath, mimeType: row.mime_type };
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return { kind: "not_found" };
    }
    throw err;
  }
}

/**
 * Sets the manually-assigned file role (spec 03's role list). Per
 * Phase 0 decision 4 and docs/IMPLEMENTATION_PLAN.md Phase 4, this is
 * always a direct user choice in v1 — there is no automatic suggestion
 * to confirm or override.
 */
export function setFileRole(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  role: FileRole,
): EvidenceItemDetail {
  if (!FILE_ROLES.includes(role)) {
    throw new InvalidRoleError(role);
  }
  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new Error(`Evidence item ${itemId} not found in this workspace`);
  }

  db.prepare("UPDATE evidence_items SET file_role = ? WHERE id = ?").run(role, itemId);
  return getItemDetail(db, workspaceId, itemId)!;
}

export class InvalidRoleError extends Error {
  constructor(role: string) {
    super(`"${role}" is not a recognized file role`);
    this.name = "InvalidRoleError";
  }
}

export interface SaveAnswerInput {
  value: string;
  confidence: SuggestionConfidence | null;
  note: string | null;
}

/**
 * Autosaves one guided-question answer. Idempotent per (item, question)
 * — re-saving the same question overwrites the prior answer rather than
 * accumulating history, matching how NotesEditor's autosave already
 * behaves (Phase 3).
 */
export function saveAnswer(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  questionId: string,
  input: SaveAnswerInput,
): ReviewAnswer {
  if (input.confidence !== null && !SUGGESTION_CONFIDENCES.includes(input.confidence)) {
    throw new Error(`"${input.confidence}" is not a recognized confidence level`);
  }
  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new Error(`Evidence item ${itemId} not found in this workspace`);
  }

  db.prepare(
    `INSERT INTO review_answers (evidence_item_id, question_id, value, source, confidence, note)
     VALUES (?, ?, ?, 'user', ?, ?)
     ON CONFLICT(evidence_item_id, question_id) DO UPDATE SET
       value = excluded.value, confidence = excluded.confidence, note = excluded.note,
       answered_at = datetime('now')`,
  ).run(itemId, questionId, input.value, input.confidence, input.note);

  const row = db
    .prepare(
      "SELECT question_id, value, source, confidence, note, answered_at FROM review_answers WHERE evidence_item_id = ? AND question_id = ?",
    )
    .get(itemId, questionId) as {
    question_id: string;
    value: string;
    source: string;
    confidence: string | null;
    note: string | null;
    answered_at: string;
  };

  return {
    questionId: row.question_id,
    value: row.value,
    source: row.source,
    confidence: row.confidence as SuggestionConfidence | null,
    note: row.note,
    answeredAt: row.answered_at,
  };
}
