import type { ArchiveSimilarReasonCode } from "./archiveSimilarEligibility.js";
import type { ArchiveSimilarPresetId } from "./archiveSimilarPresets.js";
import type { InclusionDecision, ReviewDecisionAction, ReviewStatus, SuggestionConfidence } from "./enums.js";
import type { ReviewDraftPayload } from "./models.js";

/**
 * Wire types for the Archive Similar preview/apply/undo endpoints. Kept
 * in `shared` so the web client and server routes can never disagree on
 * the request/response shape (same reasoning as every other API
 * contract type in this file's neighbors).
 */

export interface ArchiveSimilarReviewTemplate {
  evidenceTypeId: string;
  answers: Record<string, { value: string; confidence: SuggestionConfidence | null }>;
  decisionAction: ReviewDecisionAction;
}

/** One derived answer shown/applied for an eligible item — currently only the Design Mockup preset's per-item creation-date question. */
export interface ArchiveSimilarDerivedAnswer {
  value: string;
  confidence: SuggestionConfidence;
  note: string | null;
}

export interface ArchiveSimilarEligibleItem {
  itemId: string;
  filename: string;
  originalPath: string;
  reviewStatus: ReviewStatus;
  evidenceTypeId: string | null;
  /** Present only for presets with a per-item derived field (Design Mockup) — keyed by question id, one entry per `ArchiveSimilarPreviewResponse.derivedField`. Undefined for Product Mockup, which has no derived questions. */
  derivedAnswers?: Record<string, ArchiveSimilarDerivedAnswer>;
}

/** Describes the one per-item derived question a preset computes (e.g. Design Mockup's creation-date), so the modal can render a generic "here's what will be auto-filled, and why" explanation without hardcoding a preset check. `null` for presets with nothing derived (Product Mockup). */
export interface ArchiveSimilarDerivedFieldInfo {
  questionId: string;
  source: "filesystem_last_modified";
  defaultConfidence: SuggestionConfidence;
}

export interface ArchiveSimilarExcludedItem {
  itemId: string;
  filename: string;
  reasonCode: ArchiveSimilarReasonCode;
  reasonLabel: string;
}

export interface ArchiveSimilarPreviewRequest {
  sourceItemId: string;
  reviewTemplate: ArchiveSimilarReviewTemplate;
}

export interface ArchiveSimilarPreviewResponse {
  presetId: ArchiveSimilarPresetId;
  sourceItem: { itemId: string; filename: string; originalPath: string };
  scope: { folderPath: string; evidenceTypeId: string; mediaType: "image" };
  templateSummary: ArchiveSimilarReviewTemplate;
  /** Non-null only for presets with a per-item derived question (Design Mockup). */
  derivedField: ArchiveSimilarDerivedFieldInfo | null;
  eligible: ArchiveSimilarEligibleItem[];
  excluded: ArchiveSimilarExcludedItem[];
  eligibleCount: number;
  excludedCount: number;
  previewToken: string;
}

export interface ArchiveSimilarApplyRequest {
  sourceItemId: string;
  selectedItemIds: string[];
  reviewTemplate: ArchiveSimilarReviewTemplate;
  archiveCurrentItem: boolean;
  /**
   * The source item's complete current Review Draft (notes, connections,
   * usefulness override, evidence type, all answers — the same payload
   * a normal Save & Next would send), with `decisionAction: "archive"`.
   * Required whenever `archiveCurrentItem` is true — applying only the
   * 3-field `reviewTemplate` to the source would silently drop any
   * unsaved notes/connections/override the user had pending, since
   * those aren't part of the bulk-review template at all. Ignored for
   * every other candidate, which never has unsaved draft state to lose.
   */
  sourceItemPayload?: ReviewDraftPayload;
  previewToken?: string;
  idempotencyKey: string;
  /**
   * Confidence applied to every automatically-derived per-item answer
   * this operation produces (only meaningful for presets with a derived
   * field — Design Mockup's creation-date question). Defaults to
   * "medium" server-side when omitted or invalid — never affects the
   * confidence of any copied (non-derived) answer.
   */
  dateConfidence?: SuggestionConfidence;
}

export interface ArchiveSimilarSkippedItem {
  itemId: string;
  reasonCode: ArchiveSimilarReasonCode;
  reasonLabel: string;
}

export type BulkOperationStatus = "completed" | "partially_completed" | "failed";
export type BulkOperationUndoStatus = "undone" | "partially_undone";

export interface ArchiveSimilarApplyResponse {
  operationId: number;
  requestedCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  skipped: ArchiveSimilarSkippedItem[];
  status: BulkOperationStatus;
}

export interface ArchiveSimilarUndoResponse {
  operationId: number;
  requestedCount: number;
  restoredCount: number;
  skippedCount: number;
  failedCount: number;
  skipped: ArchiveSimilarSkippedItem[];
  undoStatus: BulkOperationUndoStatus;
}

/** Snapshot of exactly the review fields Archive Similar can change for one item — used for both the audit before/after record and Undo's staleness check. Never includes filename, path, connections, notes, or other file-specific data, since this operation never touches those. */
export interface ArchiveSimilarItemSnapshot {
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
  decidedAt: string | null;
  evidenceTypeId: string | null;
  evidenceTypeRegistryVersion: string | null;
  evidenceTypeConfidence: SuggestionConfidence | null;
  evidenceTypeReason: string | null;
  evidenceTypeSource: "suggested" | "user" | null;
  evidenceTypeConfirmedAt: string | null;
  fileRole: string | null;
  answers: Record<string, { value: string; source: string; confidence: SuggestionConfidence | null; note: string | null; answeredAt: string } | null>;
}
