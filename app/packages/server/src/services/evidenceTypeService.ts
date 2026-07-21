import type Database from "better-sqlite3";
import type { EvidenceItemDetail, EvidenceTypeSuggestion } from "@trademark-evidence-assistant/shared";
import { EVIDENCE_TYPE_REGISTRY_META, getEvidenceType } from "@trademark-evidence-assistant/shared";
import {
  computeEvidenceTypeSuggestion,
  getItemDetail,
  InvalidRoleError,
  saveAnswer as saveReviewAnswer,
  setFileRole,
  type SaveAnswerInput,
} from "./reviewService.js";

export class InvalidEvidenceTypeError extends Error {
  constructor(typeId: string) {
    super(`"${typeId}" is not a recognized evidence type`);
    this.name = "InvalidEvidenceTypeError";
  }
}

export class UnknownInterviewQuestionError extends Error {
  constructor(questionId: string, typeId: string) {
    super(`"${questionId}" is not part of the "${typeId}" interview`);
    this.name = "UnknownInterviewQuestionError";
  }
}

/**
 * Computes a fresh, non-persisted suggestion for an item — never called
 * once a type has been confirmed (Part 4: suggestions are only shown
 * while the classification is still open). Thin alias over
 * `reviewService.computeEvidenceTypeSuggestion`, kept under this
 * service's name for route-layer clarity.
 */
export function getSuggestion(db: Database.Database, workspaceId: number, itemId: string): EvidenceTypeSuggestion | null {
  return computeEvidenceTypeSuggestion(db, workspaceId, itemId);
}

/**
 * Confirms (or changes) an item's evidence type. Always requires an
 * explicit call — there is no path that persists a suggestion without
 * this function being invoked by the user's Confirm/Change action
 * (Part 4: "never auto-confirm").
 *
 * Also bridges to the legacy `file_role` column via the type's
 * `legacyFileRole`, so Phase 6's scoringEngine keeps receiving a real
 * signal without this phase rewriting scoring itself. See
 * docs/ADR_0001_EVIDENCE_CLASSIFICATION_FRAMEWORK.md.
 */
export function confirmType(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  typeId: string,
  source: "suggested" | "user",
  confidence: string | null,
  reason: string | null,
): EvidenceItemDetail {
  const definition = getEvidenceType(typeId);
  if (!definition) {
    throw new InvalidEvidenceTypeError(typeId);
  }
  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new Error(`Evidence item ${itemId} not found in this workspace`);
  }

  db.prepare(
    `UPDATE evidence_items
     SET evidence_type_id = ?, evidence_type_registry_version = ?, evidence_type_confidence = ?,
         evidence_type_reason = ?, evidence_type_source = ?, evidence_type_confirmed_at = datetime('now')
     WHERE id = ?`,
  ).run(typeId, EVIDENCE_TYPE_REGISTRY_META.version, confidence, reason, source, itemId);

  if (definition.legacyFileRole) {
    try {
      setFileRole(db, workspaceId, itemId, definition.legacyFileRole);
    } catch (err) {
      if (!(err instanceof InvalidRoleError)) throw err;
    }
  }

  return getItemDetail(db, workspaceId, itemId)!;
}

/** Autosaves one interview answer, after confirming it belongs to the item's confirmed type's interview. */
export function saveInterviewAnswer(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  questionId: string,
  input: SaveAnswerInput,
) {
  const row = db
    .prepare("SELECT evidence_type_id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId) as { evidence_type_id: string | null } | undefined;
  if (!row) {
    throw new Error(`Evidence item ${itemId} not found in this workspace`);
  }
  const definition = row.evidence_type_id ? getEvidenceType(row.evidence_type_id) : null;
  if (!definition || !definition.interview.some((q) => q.id === questionId)) {
    throw new UnknownInterviewQuestionError(questionId, row.evidence_type_id ?? "(none confirmed)");
  }
  return saveReviewAnswer(db, workspaceId, itemId, questionId, input);
}
