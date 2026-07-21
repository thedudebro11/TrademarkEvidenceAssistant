import type { InclusionDecision, ReviewStatus } from "./enums.js";

/**
 * Wire types for "Remove Missing Records" (Home page cleanup workflow).
 * Kept in `shared` for the same reason as every other feature's API
 * contract types here — the web client and server routes must never
 * disagree on the request/response shape.
 */

/** Why a candidate is (or isn't) confidently missing — engines/fileAvailability.ts's classification, mirrored here for the wire. Only `MISSING_FILE` is ever selectable by default. */
export type MissingRecordAvailabilityReasonCode = "MISSING_FILE" | "PERMISSION_DENIED" | "DRIVE_UNAVAILABLE" | "INVALID_PATH" | "PATH_TEMPORARILY_UNAVAILABLE";

/** Why a requested item was skipped instead of removed during an actual removal attempt — a superset of the availability reasons (a file can also "reappear" between preview and removal, which isn't a filesystem-classification outcome). */
export type MissingRecordSkipReasonCode = MissingRecordAvailabilityReasonCode | "FILE_REAPPEARED" | "ITEM_NOT_FOUND" | "NOT_MISSING";

export const MISSING_RECORD_SKIP_REASON_LABELS: Record<MissingRecordSkipReasonCode, string> = {
  MISSING_FILE: "The file is missing", // never actually used as a *skip* reason — included for exhaustiveness with the availability type
  PERMISSION_DENIED: "The file's location could not be read (permission denied)",
  DRIVE_UNAVAILABLE: "The evidence drive is currently unreachable",
  INVALID_PATH: "The recorded path is invalid",
  PATH_TEMPORARILY_UNAVAILABLE: "The file's location could not be confirmed right now",
  FILE_REAPPEARED: "The file became available again",
  ITEM_NOT_FOUND: "This record no longer exists",
  NOT_MISSING: "This record is not currently marked missing",
};

/** Per-item counts of rows that removing this evidence record would also remove — shown in the modal so a user can see "this has 3 review answers, 2 connections" before confirming. */
export interface MissingRecordDependencyCounts {
  reviewAnswers: number;
  connectionsOutgoing: number;
  connectionsIncoming: number;
  duplicateMemberships: number;
  hasHeicPreview: boolean;
  hasNotes: boolean;
  bulkOperationReferences: number;
  exportReferences: number;
}

export interface MissingRecordCandidate {
  evidenceItemId: string;
  filename: string;
  originalPath: string;
  folderPath: string;
  evidenceTypeId: string | null;
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
  connectionsCount: number;
  notesCount: number; // 0 or 1 — evidence_items.notes is a single field, not a list
  answersCount: number;
  fileSize: number;
  lastKnownModifiedAt: string | null;
  missingSince: string | null;
  /** Always `MISSING_FILE` for a candidate in `confidentlyMissing` — `availabilityReasonCode` on an `uncertain` entry explains why it's excluded from the default-selectable set instead. */
  availabilityReasonCode: MissingRecordAvailabilityReasonCode;
  dependencyCounts: MissingRecordDependencyCounts;
  /** True when the record carries meaningful manual work (Included/Needs Follow-Up, a confirmed evidence type, answers, notes, or connections) — drives the "Contains reviewed evidence" warning badge. */
  hasReviewedWork: boolean;
}

export interface MissingRecordsPreviewResponse {
  /** Confidently missing (a fresh `MISSING_FILE` classification) — selectable by default. */
  confidentlyMissing: MissingRecordCandidate[];
  /** Marked missing by the last scan, but the fresh recheck couldn't confirm `MISSING_FILE` (e.g. the drive is temporarily unreachable) — shown separately, never selectable by default, requires manual resolution. */
  uncertain: MissingRecordCandidate[];
}

export interface RemoveMissingRecordsRequest {
  evidenceItemIds: string[];
  idempotencyKey: string;
  confirmation: true;
  /** Default true — see HOME PAGE UX "Export a backup... enabled by default." */
  exportBackup?: boolean;
}

export interface RemovedMissingRecord {
  evidenceItemId: string;
  filename: string;
}

export interface SkippedMissingRecord {
  evidenceItemId: string;
  filename: string;
  reasonCode: MissingRecordSkipReasonCode;
  reasonLabel: string;
}

export type MissingRecordsOperationStatus = "completed" | "partially_completed" | "failed";

export interface RemoveMissingRecordsResponse {
  operationId: number;
  requestedCount: number;
  removedCount: number;
  skippedCount: number;
  failedCount: number;
  removed: RemovedMissingRecord[];
  skipped: SkippedMissingRecord[];
  status: MissingRecordsOperationStatus;
  /** Present only when `exportBackup` was requested and the operation succeeded far enough to produce one — the client downloads this JSON as the timestamped backup file. */
  backup: MissingRecordsBackup | null;
}

/** One backup entry per removed record — structured application data only, never the (already-absent) file binary. */
export interface MissingRecordsBackupEntry {
  evidenceItemId: string;
  originalFilename: string;
  originalPath: string;
  evidenceTypeId: string | null;
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
  notes: string | null;
  metadata: { width: number | null; height: number | null } | null;
  answers: { questionId: string; value: string; source: string; confidence: string | null; note: string | null }[];
  connections: { direction: "outgoing" | "incoming"; otherEvidenceItemId: string; type: string; explanation: string; confidence: string | null }[];
}

export interface MissingRecordsBackup {
  generatedAt: string;
  workspaceName: string;
  operationId: number;
  records: MissingRecordsBackupEntry[];
}

export type MissingRecordsUndoStatus = "undone" | "partially_undone";

export interface RestoredMissingRecord {
  evidenceItemId: string;
  filename: string;
}

export interface UndoMissingRecordsRemovalResponse {
  operationId: number;
  requestedCount: number;
  restoredCount: number;
  skippedCount: number;
  restored: RestoredMissingRecord[];
  skipped: SkippedMissingRecord[];
  undoStatus: MissingRecordsUndoStatus;
}
