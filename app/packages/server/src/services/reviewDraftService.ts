import type Database from "better-sqlite3";
import type { EvidenceItemDetail, ReviewDraftPayload } from "@trademark-evidence-assistant/shared";
import { getItemDetail, recordDecision, saveNotes } from "./reviewService.js";
import { confirmType, saveInterviewAnswer } from "./evidenceTypeService.js";
import { createConnection, removeConnection, setNoRelatedEvidence } from "./connectionService.js";
import { setOverride, clearOverride } from "./scoringService.js";

/**
 * The core save steps, with NO transaction of their own — callable both
 * as the single-item save path (wrapped by `saveDraft` below) and by
 * `bulkReviewService.ts`'s Archive Similar apply step, which needs many
 * items' worth of this same logic inside one outer transaction spanning
 * the whole bulk operation (so a failure partway through rolls back
 * every file, not just the one that failed).
 *
 * better-sqlite3 transaction functions technically nest safely via
 * SAVEPOINT, but this codebase deliberately doesn't rely on that: the
 * bulk service calls this function directly inside its own single
 * `db.transaction()`, so there is exactly one transaction boundary per
 * operation, not a nested one whose behavior depends on library
 * internals.
 *
 * Order matters: evidence type is confirmed first so interview-answer
 * validation (which checks the question belongs to the *current*
 * confirmed type's interview) sees the up-to-date type within the same
 * transaction, not the pre-save one.
 */
export function saveDraftWithTx(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  payload: ReviewDraftPayload,
): void {
  if (payload.evidenceType) {
    confirmType(
      db,
      workspaceId,
      itemId,
      payload.evidenceType.typeId,
      payload.evidenceType.source,
      payload.evidenceType.confidence,
      payload.evidenceType.reason,
    );
  }

  for (const [questionId, answer] of Object.entries(payload.interviewAnswers)) {
    saveInterviewAnswer(db, workspaceId, itemId, questionId, {
      value: answer.value,
      confidence: answer.confidence,
      note: answer.note,
    });
  }

  for (const connectionId of payload.connectionIdsToRemove) {
    removeConnection(db, workspaceId, connectionId);
  }
  for (const toAdd of payload.connectionsToAdd) {
    createConnection(db, workspaceId, itemId, toAdd.targetPath, {
      type: toAdd.type,
      explanation: toAdd.explanation,
      confidence: toAdd.confidence,
    });
  }

  // Applied after every connection add/remove above, so the
  // zero-connections check inside setNoRelatedEvidence reflects this
  // save's final state, not the state before it. A contradictory
  // payload (noRelatedEvidence: true alongside a real connectionsToAdd
  // entry) is silently resolved in favor of the connection existing —
  // see setNoRelatedEvidence's own doc comment.
  setNoRelatedEvidence(db, workspaceId, itemId, payload.noRelatedEvidence);

  if (payload.usefulnessOverride.action === "set") {
    setOverride(
      db,
      workspaceId,
      itemId,
      payload.usefulnessOverride.score ?? 0,
      payload.usefulnessOverride.band ?? "Undetermined",
      payload.usefulnessOverride.note ?? "",
    );
  } else if (payload.usefulnessOverride.action === "clear") {
    clearOverride(db, workspaceId, itemId);
  }

  saveNotes(db, workspaceId, itemId, payload.notes);

  if (payload.decisionAction) {
    recordDecision(db, workspaceId, itemId, payload.decisionAction);
  }
}

/**
 * Persists an entire Review Draft in one DB transaction — the atomic
 * counterpart to the five separate calls panels used to make directly
 * before this change. Uses the same `db.transaction()` pattern already
 * established in `scanService.ts`'s duplicate rebuild: if any step
 * throws (an invalid evidence type, a bad connection, an invalid
 * override), better-sqlite3 rolls back everything written so far in
 * this call and re-throws — nothing partial is ever committed, and the
 * client's draft is left untouched on the frontend since the request
 * simply fails (see ReviewQueue.tsx's save handler).
 */
export function saveDraft(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  payload: ReviewDraftPayload,
): EvidenceItemDetail {
  const run = db.transaction(() => saveDraftWithTx(db, workspaceId, itemId, payload));
  run();
  return getItemDetail(db, workspaceId, itemId)!;
}
