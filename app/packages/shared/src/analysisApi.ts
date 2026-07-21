import type { ConnectionType, SuggestionConfidence } from "./enums.js";

/**
 * Evidence Intelligence Phase 1 — wire types for the current-item
 * "Analyze Evidence" flow. Everything here describes a *suggestion*,
 * never a confirmed value: nothing in this file is written into
 * evidence_items, review_answers, or connections directly. The
 * confirmation endpoint (`POST /api/evidence-items/:id/analysis/confirm`)
 * is the one bridge between this world and the existing
 * saveDraft/saveDraftWithTx review path — see analysisService.ts.
 */

export type AnalysisRunStatus = "running" | "completed" | "failed";
export type AnalysisGenerationMethod = "deterministic" | "ai_provider";
export type SuggestionState = "proposed" | "edited" | "accepted" | "rejected" | "unresolved" | "superseded" | "stale";
export type SuggestionFieldKind = "evidence_type" | "question_answer";

export type ExtractedEntityType =
  | "fatletic_mark"
  | "order_number"
  | "shipment_number"
  | "tracking_number"
  | "invoice_number"
  | "product_title"
  | "garment_type"
  | "color"
  | "size"
  | "quantity"
  | "price"
  | "total"
  | "shipping_carrier"
  | "sku"
  | "order_status";

export type DateAssertionSourceType =
  | "exif_date_time_original"
  | "exif_create_date"
  | "video_creation"
  | "visible_order_date"
  | "visible_shipment_date"
  | "visible_delivery_date"
  | "visible_invoice_date"
  | "filename_inferred"
  | "fs_created"
  | "fs_modified"
  | "import_date"
  | "manually_confirmed";

export type TimezoneStatus = "known" | "unknown" | "not_applicable";
export type DateConflictState = "none" | "conflicts_with_other_assertion";
export type DateConfirmationState = "unconfirmed" | "confirmed";

export interface AnalysisRunSummary {
  id: number;
  evidenceItemId: string;
  sourceFingerprint: string;
  metadataVersion: string;
  evidenceTypeRegistryVersion: string;
  questionRegistryVersion: string;
  deterministicRuleVersion: string;
  status: AnalysisRunStatus;
  initiatedAt: string;
  completedAt: string | null;
  providerId: string | null;
  providerModel: string | null;
  providerVersion: string | null;
  errorMessage: string | null;
  /** True when a later run exists for this same item, or the item's current state no longer matches this run's recorded versions/fingerprint — computed live, never stored, so it can never drift. See analysisService.ts's computeRunStaleness. */
  stale: boolean;
}

export interface EvidenceSuggestionView {
  id: number;
  analysisRunId: number;
  fieldKind: SuggestionFieldKind;
  /** Question id for 'question_answer'; `null` for 'evidence_type'. */
  fieldId: string | null;
  proposedValue: string;
  normalizedValue: string | null;
  confidence: SuggestionConfidence;
  rationale: string;
  supportingSignals: string[];
  sourceLocations: string[];
  generationMethod: AnalysisGenerationMethod;
  state: SuggestionState;
  userCorrection: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ExtractedEntityView {
  id: number;
  entityType: ExtractedEntityType;
  rawText: string;
  normalizedValue: string | null;
  sourceLocation: string | null;
  extractionMethod: string;
  confidence: SuggestionConfidence;
}

export interface DateAssertionView {
  id: number;
  sourceType: DateAssertionSourceType;
  rawValue: string;
  normalizedValue: string | null;
  timezoneStatus: TimezoneStatus;
  sourceLocation: string | null;
  confidence: SuggestionConfidence;
  conflictState: DateConflictState;
  confirmationState: DateConfirmationState;
  explanation: string;
}

/**
 * One confirmed exemplar retrieved to explain/corroborate an evidence-
 * type suggestion — see server's exemplarRetrieval.ts. Never itself a
 * suggestion or a confirmed value; purely explanatory. `matchedSignals`
 * is the exact, human-readable list of reasons this exemplar was
 * retrieved — retrieval is deterministic nearest-neighbor scoring over
 * real confirmed decisions, never a trained model, so there is always a
 * concrete explanation to show.
 */
export interface RetrievedExampleView {
  id: number;
  exampleItemId: string;
  exampleFilename: string;
  exampleOriginalPath: string;
  exampleEvidenceTypeId: string;
  matchedSignals: string[];
  /** 0..1 — how strongly this exemplar's signals matched the item being analyzed. */
  influenceScore: number;
  /** Whether this exemplar's own confirmed type agrees with the top evidence-type suggestion. */
  agreement: "supports" | "contradicts";
}

export interface ConnectionSuggestionView {
  id: number;
  sourceItemId: string;
  targetItemId: string;
  targetFilename: string;
  targetOriginalPath: string;
  proposedType: ConnectionType;
  matchedIdentifierType: string;
  matchedIdentifierValue: string;
  confidence: SuggestionConfidence;
  rationale: string;
  contradictionWarning: string | null;
  state: "proposed" | "accepted" | "rejected" | "superseded" | "stale";
}

/** Response body for POST /api/evidence-items/:id/analysis (start/reanalyze) and GET .../analysis (latest). */
export interface AnalysisResultResponse {
  run: AnalysisRunSummary;
  evidenceTypeSuggestions: EvidenceSuggestionView[];
  answerSuggestions: EvidenceSuggestionView[];
  entities: ExtractedEntityView[];
  dates: DateAssertionView[];
  connectionSuggestions: ConnectionSuggestionView[];
  retrievedExamples: RetrievedExampleView[];
  summary: {
    answerCount: number;
    dateCount: number;
    identifierCount: number;
    connectionCount: number;
  };
  /** `null` when no AI provider is configured — deterministic results above are still fully valid and complete. */
  providerAvailable: boolean;
}

export interface AcceptedAnswer {
  suggestionId: number;
  /** The value actually saved — equals the suggestion's proposedValue unless the user edited it (an 'edited' suggestion). */
  value: string;
}

export interface ConfirmAnalysisRequest {
  analysisRunId: number;
  /** id of the evidence-type suggestion to accept, or `null` to accept none. */
  acceptedEvidenceTypeSuggestionId: number | null;
  acceptedAnswers: AcceptedAnswer[];
  rejectedSuggestionIds: number[];
  acceptedConnectionSuggestionIds: number[];
  rejectedConnectionSuggestionIds: number[];
}

export interface ConfirmAnalysisResponse {
  evidenceItemId: string;
  acceptedEvidenceType: string | null;
  acceptedAnswerCount: number;
  acceptedConnectionCount: number;
  rejectedCount: number;
}

/**
 * Evidence Intelligence Phase 2 — server-side batch analysis. Every job
 * only ever calls the existing per-item pipeline above; it can never
 * confirm anything itself. See server's batchAnalysisService.ts.
 */
export type SelectionMode = "selected_ids" | "folder" | "all_unreviewed" | "stale" | "retry_failed";

/**
 * `extracting`/`classifying`/`suggesting` from the original spec are
 * deliberately not modeled as distinct persisted states here: the
 * underlying per-item pipeline (analysisService.startAnalysis) runs
 * extraction, classification, and suggestion generation as one
 * inseparable step, so a job-level sub-phase for each would be a
 * fabricated progress signal this codebase's own "never invent a signal
 * that isn't real" convention (see ocrEngine.ts's extractors, the
 * deterministic-only classification rules) rules out. `running` is the
 * one honest in-progress state; `readyForReview` is exposed as a
 * computed boolean below rather than a separate status, since it's
 * simply "status is a successful terminal state" — see the final report
 * for this reasoning spelled out.
 */
export type BatchAnalysisJobStatusValue = "queued" | "running" | "completed" | "completed_with_failures" | "interrupted" | "canceled" | "failed";

export interface BatchAnalysisJobStatus {
  id: number;
  status: BatchAnalysisJobStatusValue;
  selectionMode: SelectionMode;
  selectionParam: string | null;
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  currentItemId: string | null;
  /** Resolved display fields for `currentItemId` — never show the raw UUID in the UI. Both null exactly when `currentItemId` is null. */
  currentFilename: string | null;
  currentFolder: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancellationRequested: boolean;
  errorSummary: string | null;
  deterministicRuleVersion: string;
  evidenceTypeRegistryVersion: string;
  providerAvailable: boolean;
  /** True once `status` is a successful terminal state ('completed' or 'completed_with_failures') — the signal to show the Review Suggestions queue. */
  readyForReview: boolean;
}

export interface StartBatchAnalysisRequest {
  selectionMode: SelectionMode;
  /** Required (non-empty) for selectionMode: 'selected_ids'. */
  itemIds?: string[];
  /** Required for selectionMode: 'folder'. Exact folder match, not recursive. */
  folderPath?: string;
  /** Required for selectionMode: 'retry_failed' — the prior job whose failed items should be retried. */
  sourceJobId?: number;
}

export interface StartBatchAnalysisResponse {
  jobId: number;
}

/** Response for GET /api/analysis/batch/preview — a pre-run report of what a selection would do, without starting anything. */
export interface BatchAnalysisSelectionPreview {
  eligibleCount: number;
  folders: string[];
  fileTypeBreakdown: Record<string, number>;
  /** Items matched by the selection but currently missing/unreadable — would be skipped, not attempted. */
  unreadableCount: number;
}

export interface SuggestionQueueItemView {
  evidenceItemId: string;
  filename: string;
  folder: string;
  /** For thumbnail rendering (image vs heic vs a file-type fallback) — never re-derived by guessing from the filename. */
  extension: string;
  analysisRunId: number;
  /** When this item's current analysis run completed — powers "newest analysis" sorting. */
  analyzedAt: string;
  suggestedEvidenceType: string | null;
  alternativeEvidenceTypes: string[];
  confidence: SuggestionConfidence | null;
  answerSuggestionCount: number;
  dateCount: number;
  identifierCount: number;
  connectionSuggestionCount: number;
  hasContradiction: boolean;
  hasUnresolvedQuestion: boolean;
  failedExtraction: boolean;
  stale: boolean;
  providerAvailable: boolean;
}

export interface SuggestionQueueFilters {
  jobId?: number;
  evidenceType?: string;
  folder?: string;
  minConfidence?: SuggestionConfidence;
  unresolvedCustomerStatus?: boolean;
  hasContradiction?: boolean;
  hasConnections?: boolean;
  failedExtraction?: boolean;
  stale?: boolean;
  noProvider?: boolean;
}

export interface SuggestionQueueResponse {
  items: SuggestionQueueItemView[];
  total: number;
}
