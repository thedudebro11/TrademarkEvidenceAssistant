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
