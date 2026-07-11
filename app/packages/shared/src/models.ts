import type {
  ConnectionType,
  EvidenceCategory,
  FileRole,
  InclusionDecision,
  ReviewStatus,
  SuggestionConfidence,
  UsefulnessBand,
} from "./enums.js";

/** A configured evidence workspace (spec 12 `workspaces` table). */
export interface Workspace {
  id: number;
  name: string;
  evidenceRoot: string;
  createdAt: string;
}

/**
 * A deterministic, non-authoritative role suggestion derived from folder
 * name / filename / extension (Phase 0 decision 4). This is never
 * treated as the final role — it is shown to the user with its reason,
 * and the user must confirm or change it before it becomes authoritative.
 */
export interface RoleSuggestion {
  suggestedRole: FileRole;
  reason: string;
  confidence: SuggestionConfidence;
}

/**
 * The user-confirmed role for an evidence item, recorded separately from
 * the suggestion that (optionally) preceded it.
 */
export interface ConfirmedRole {
  role: FileRole;
  confirmedAt: string;
}

/**
 * Full Evidence Item shape per specs/03_EVIDENCE_ITEM_MODEL.md. Defined
 * now as a shared contract; scanning/population logic is built in
 * Phase 2, not Phase 1.
 */
export interface EvidenceItem {
  id: string;
  workspaceId: number;
  originalPath: string;
  originalFilename: string;
  extension: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  discoveredAt: string;
  filesystemCreatedAt: string | null;
  filesystemModifiedAt: string | null;
  previewType: string | null;
  reviewStatus: ReviewStatus;
  evidenceCategory: EvidenceCategory;
  roleSuggestion: RoleSuggestion | null;
  confirmedRole: ConfirmedRole | null;
  usefulnessBand: UsefulnessBand | null;
  usefulnessScore: number | null;
  explanation: string | null;
  notes: string | null;
}

/** A typed connection between two Evidence Items (spec 07). */
export interface EvidenceConnection {
  id: string;
  sourceItemId: string;
  targetItemId: string;
  type: ConnectionType;
  explanation: string;
  confidence: SuggestionConfidence;
  createdBy: string;
  createdAt: string;
}

/** Response body for GET /api/health. */
export interface HealthResponse {
  status: "ok" | "error";
  workspace: {
    name: string;
    evidenceRoot: string;
    evidenceRootExists: boolean;
  };
  database: {
    connected: boolean;
  };
}

/**
 * Response body for POST /api/scan. Mirrors packages/server's
 * ScanService.ScanSummary — kept here so the web client can be typed
 * against it without importing server internals.
 */
export interface ScanSummary {
  scanRunId: number;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  filesDiscovered: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsContentChanged: number;
  itemsMissing: number;
  duplicateGroups: number;
  errorMessage: string | null;
}

/** Another Evidence Item that shares this one's exact SHA-256 hash. */
export interface DuplicateMember {
  evidenceItemId: string;
  originalPath: string;
}

/** Deterministic, best-effort type-specific metadata (Phase 2 Metadata Engine). */
export interface EvidenceItemMetadata {
  width: number | null;
  height: number | null;
  pageCount: number | null;
}

/**
 * One guided-question answer (spec 06: "every answer stores value,
 * source, confidence, and optional note").
 */
export interface ReviewAnswer {
  questionId: string;
  value: string;
  source: string;
  confidence: SuggestionConfidence | null;
  note: string | null;
  answeredAt: string;
}

/**
 * Full detail for one Evidence Item, as served by the Review Queue API.
 * Deliberately excludes fields that don't exist until later phases
 * (roleSuggestion/confirmedRole → automatic suggestion is not built in
 * v1 per Phase 0 decision 4, connections → Phase 5, usefulness →
 * Phase 6) rather than sending always-null placeholders.
 */
export interface EvidenceItemDetail {
  id: string;
  originalPath: string;
  originalFilename: string;
  extension: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  discoveredAt: string;
  fsCreatedAt: string | null;
  fsModifiedAt: string | null;
  missingSince: string | null;
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
  notes: string | null;
  notesUpdatedAt: string | null;
  decidedAt: string | null;
  metadata: EvidenceItemMetadata | null;
  duplicates: DuplicateMember[];
  fileRole: FileRole | null;
  answers: ReviewAnswer[];
}

/** Review Queue progress counts (docs/ARCHITECTURE_CONSTITUTION.md #3 "Review Progress"). */
export interface ReviewProgress {
  total: number;
  unreviewed: number;
  reviewed: number;
  needsFollowUp: number;
  excluded: number;
}
