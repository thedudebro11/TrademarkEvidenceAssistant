import type {
  ConnectionType,
  EvidenceCategory,
  FileRole,
  HeicDecoderSelection,
  HeicPreviewStatus,
  InclusionDecision,
  ReviewDecisionAction,
  ReviewStatus,
  SuggestionConfidence,
  UsefulnessBand,
} from "./enums.js";
import type { EvidenceTypeSuggestion } from "./evidenceTypeRegistry.js";

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
  id: number;
  sourceItemId: string;
  targetItemId: string;
  type: ConnectionType;
  explanation: string;
  confidence: SuggestionConfidence | null;
  createdBy: string;
  createdAt: string;
}

/**
 * One connection as rendered from a specific item's point of view — the
 * "chain" spec 07 asks for (no graph UI in v1). `direction` tells the UI
 * whether this item was the source or target of the underlying
 * connection, so it can render "this supports →" vs "← supported by".
 */
export interface ConnectionSummary {
  connectionId: number;
  direction: "outgoing" | "incoming";
  relatedItemId: string;
  relatedOriginalPath: string;
  type: ConnectionType;
  explanation: string;
  confidence: SuggestionConfidence | null;
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

/**
 * Response body for GET /api/heic-previews/backfill/:jobId. Mirrors
 * packages/server's heicPreviewService.HeicBackfillJobStatus.
 *
 * `queued` and `running` are the only non-terminal states a poller
 * should keep waiting through — `queued` is not currently ever emitted
 * (this app has no real job queue; a job starts processing immediately
 * after creation), but is part of the contract so a future "wait for a
 * concurrency slot" state has an honest status to report without a
 * breaking type change. `completed_with_failures` is distinct from
 * `completed` so a client can tell "ran, but not everything succeeded"
 * apart from "ran clean" without inspecting counts itself.
 * `interrupted` is a job whose row was left `running` by a server
 * process that exited before finishing it — reconciled automatically on
 * the next backfill call (see reconcileAbandonedHeicBackfillJobs).
 */
export interface HeicBackfillJobStatus {
  id: number;
  status: "queued" | "running" | "completed" | "completed_with_failures" | "failed" | "interrupted";
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  /** A short, safe-to-display reason — set only for 'failed' or 'interrupted'. */
  errorMessage: string | null;
}

/** Response body for POST /api/export. Mirrors packages/server's ExportService.ExportSummary. */
export interface ExportSummary {
  exportId: number;
  status: "completed" | "failed";
  exportPath: string;
  itemsExported: number;
  errorMessage: string | null;
}

/** Response body for POST /api/binder. Mirrors packages/server's BinderService.BinderSummary. */
export interface BinderSummary {
  binderGenerationId: number;
  exportId: number;
  itemCount: number;
  outputPaths: { markdown: string; html: string; json: string; csv: string };
}

/**
 * Response body for GET /api/evidence-items/:id/ocr. Mirrors
 * packages/server's ocrEngine.OcrExtraction. Every candidate is exactly
 * what the deterministic regex extraction found — never ranked,
 * merged, or guessed at; the client shows all of them and requires an
 * explicit click to use one, per this project's "never auto-confirm a
 * suggestion" rule.
 */
export interface OcrExtraction {
  rawText: string;
  dateCandidates: string[];
  orderNumberCandidates: string[];
}

/**
 * Response body for GET /api/evidence-items/:id/video-metadata.
 * Mirrors packages/server's VideoMetadataProvider interface. Every
 * field is nullable because the *default* provider (in use today)
 * doesn't decode video at all — it's an honest "we don't know yet," not
 * a broken feature. A future ffmpeg-backed provider populates the same
 * shape with real values; nothing else in the app needs to change when
 * that happens (see videoMetadataProvider.ts's own doc comment).
 */
export interface VideoMetadata {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
  bitrateKbps: number | null;
  hasAudio: boolean | null;
}

/** Another Evidence Item that shares this one's exact SHA-256 hash. */
export interface DuplicateMember {
  evidenceItemId: string;
  originalPath: string;
}

/** A candidate target for the Connections picker — deliberately lightweight (no metadata/answers) since this is only ever used to fill in a connection's target path. */
export interface ConnectionCandidate {
  id: string;
  originalPath: string;
  originalFilename: string;
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
  /** Confirmed evidence type id (shared/evidenceTypeRegistry.ts), or null if not yet classified. Never a suggestion — only a confirmed classification. */
  evidenceTypeId: string | null;
}

/**
 * A folder-tree view of the workspace's evidence, for the Review page's
 * tree sidebar — lets the user jump straight to a specific file instead
 * of only moving through the queue in order. Built directly from
 * `evidence_items.original_path` (see reviewService.buildEvidenceTree),
 * never from a live filesystem read — the tree can only ever show what
 * the scanner has already recorded, same as everywhere else in the app.
 */
export interface EvidenceTreeFileNode {
  type: "file";
  id: string;
  name: string;
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
}
export interface EvidenceTreeFolderNode {
  type: "folder";
  name: string;
  children: EvidenceTreeNode[];
}
export type EvidenceTreeNode = EvidenceTreeFileNode | EvidenceTreeFolderNode;

/** Deterministic, best-effort type-specific metadata (Phase 2 Metadata Engine). */
export interface EvidenceItemMetadata {
  width: number | null;
  height: number | null;
  pageCount: number | null;
  /**
   * HEIC/HEIF-only fields, extracted directly from the original file
   * (docs/ADR_0005_HEIC_PREVIEWS.md) — always null for every other
   * extension. Optional (not just nullable), so the many existing
   * fixtures/tests for non-HEIC evidence types don't need updating;
   * every real server response always includes them. Kept as clearly
   * separate assertions, never merged into one "date taken":
   * `exifDateTimeOriginal`/`exifCreateDate` are the camera's own
   * embedded timestamps; `filenameInferredDate` is a weak,
   * filename-pattern guess (e.g. `IMG_20260717_020251.heic`); the
   * item's existing `fsModifiedAt` (EvidenceItemDetail) is the
   * filesystem timestamp — never relabeled as a photo date.
   */
  exifDateTimeOriginal?: string | null;
  exifCreateDate?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  orientation?: number | null;
  colorProfile?: string | null;
  filenameInferredDate?: string | null;
}

/**
 * State of one HEIC/HEIF item's generated inline preview
 * (docs/ADR_0005_HEIC_PREVIEWS.md). Describes the *derivative* only —
 * never the original file, which this app never modifies, renames, or
 * recompresses. `null` on `EvidenceItemDetail.heicPreview` for any
 * non-HEIC/HEIF item.
 */
export interface HeicPreviewInfo {
  status: HeicPreviewStatus;
  previewMimeType: string | null;
  previewGeneratedAt: string | null;
  /** Decoder id that produced (or last attempted) this preview — e.g. `"libheif-js"` or `"imagemagick"`. */
  previewGenerator: string | null;
  previewGeneratorVersion: string | null;
  /** Whether `previewGenerator` was the app's automatic preferred decoder, or an explicit user "Retry with Alternate Decoder" choice — see heicPreviewService.ts's effectiveStatus(). */
  decoderSelection: HeicDecoderSelection;
  /** A short, safe-to-display failure reason — never a raw stack trace, command line, or server filesystem path (spec: "do not expose... to the browser"). */
  conversionError: string | null;
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
 * The user-confirmed evidence type for an item (Phase 3.5's Evidence
 * Classification Framework). `registryVersion` freezes which registry
 * version this confirmation was made against, per
 * docs/IMPLEMENTATION_PLAN.md Phase 3.5's "never silently reinterpret
 * historical reviews" rule — if the registry adds/renames/retires types
 * in a future version, an item confirmed against 1.0 keeps reading as
 * 1.0 meant it, not as the newer registry would read it today.
 */
export interface EvidenceTypeAssignment {
  typeId: string;
  registryVersion: string;
  confidence: SuggestionConfidence | null;
  reason: string | null;
  source: "suggested" | "user";
  confirmedAt: string;
}

/**
 * Full detail for one Evidence Item, as served by the Review Queue API.
 * Deliberately excludes fields that don't exist until later phases
 * (roleSuggestion/confirmedRole → superseded by evidenceType/
 * evidenceTypeSuggestion below, connections → Phase 5, usefulness →
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
  connections: ConnectionSummary[];
  usefulness: EvidenceUsefulness;
  /** Confirmed evidence type (Phase 3.5), null until the user accepts or changes a suggestion. */
  evidenceType: EvidenceTypeAssignment | null;
  /** A fresh, non-persisted suggestion — only computed while evidenceType is still unconfirmed (Part 4: "never auto-confirm"). */
  evidenceTypeSuggestion: EvidenceTypeSuggestion | null;
  /** True when the reviewer explicitly determined no related evidence exists for this item. Mutually exclusive with having any connections — see getConnectionsReviewState. */
  noRelatedEvidence: boolean;
  /**
   * Generated inline-preview state for a HEIC/HEIF item; `null` for
   * every other extension (docs/ADR_0005_HEIC_PREVIEWS.md). Optional
   * (not just nullable) so the many existing fixtures/tests built
   * before this feature — for evidence types that were never HEIC —
   * don't all need updating; every real server response always
   * includes it.
   */
  heicPreview?: HeicPreviewInfo | null;
}

/** The Connections section's three review states — "No Related Evidence" workflow. */
export type ConnectionsReviewState = "not_reviewed" | "reviewed_no_connections" | "reviewed_with_connections";

/**
 * Derives the Connections section's review state from persisted facts
 * rather than storing the state itself, so it can never drift: a
 * connection existing always means "reviewed, connections added"
 * regardless of the `noRelatedEvidence` flag's stored value (the
 * authoritative write path — connectionService.createConnection —
 * clears the flag whenever a connection is created, but this function
 * doesn't have to trust that always happened correctly).
 */
export function getConnectionsReviewState(noRelatedEvidence: boolean, connectionCount: number): ConnectionsReviewState {
  if (connectionCount > 0) return "reviewed_with_connections";
  if (noRelatedEvidence) return "reviewed_no_connections";
  return "not_reviewed";
}

/** A trademark-usefulness score (spec 08) — organizational aid only, never a legal conclusion. */
export interface UsefulnessResult {
  score: number;
  band: UsefulnessBand;
  positiveFactors: string[];
  missingElements: string[];
}

/** A user override of the computed score. Requires a note (spec 08) and is never silent. */
export interface UsefulnessOverride {
  score: number;
  band: UsefulnessBand;
  note: string;
  overriddenAt: string;
}

/**
 * Both the freshly-computed score and any override are always sent
 * together — overriding never hides the computed value
 * (docs/DESIGN_LANGUAGE.md "the application never hides ... why
 * something scored highly"). `effective` is whichever one should be
 * displayed as primary (override if present, else computed).
 */
export interface EvidenceUsefulness {
  computed: UsefulnessResult;
  override: UsefulnessOverride | null;
  effective: UsefulnessResult;
}

/** Review Queue progress counts (docs/ARCHITECTURE_CONSTITUTION.md #3 "Review Progress"). */
export interface ReviewProgress {
  total: number;
  unreviewed: number;
  reviewed: number;
  needsFollowUp: number;
  excluded: number;
}

/**
 * The item-level Review Draft (see docs/ADR_0002_REVIEW_DRAFT_STATE.md).
 * A single atomic payload sent to `PUT /api/evidence-items/:id/draft`,
 * replacing the five separate per-field calls the panels used to make
 * directly. Nothing here is persisted until the whole payload is sent —
 * see the web-side `reviewDraft.ts` for how the draft is built up in
 * memory while the user moves between accordion panels.
 */
export interface DraftEvidenceType {
  typeId: string;
  source: "suggested" | "user";
  confidence: SuggestionConfidence | null;
  reason: string | null;
}

export interface DraftInterviewAnswer {
  value: string;
  confidence: SuggestionConfidence | null;
  note: string | null;
}

export interface DraftConnectionAdd {
  targetPath: string;
  type: ConnectionType;
  explanation: string;
  confidence: SuggestionConfidence | null;
}

/**
 * `action: "none"` means "leave any existing override alone" — the
 * default, so opening other panels without touching Evaluate can never
 * clear a pre-existing override. `"set"` and `"clear"` are only reached
 * by an explicit user action inside UsefulnessPanel.
 */
export interface DraftUsefulnessOverride {
  action: "none" | "set" | "clear";
  score: number | null;
  band: UsefulnessBand | null;
  note: string | null;
}

export interface ReviewDraftPayload {
  /** null = no change (the user did not confirm/change a type this session) — never auto-confirms a mere suggestion. */
  evidenceType: DraftEvidenceType | null;
  /** Full current answer map for the confirmed type's interview; safe to always send since it's a no-op when unedited. */
  interviewAnswers: Record<string, DraftInterviewAnswer>;
  connectionsToAdd: DraftConnectionAdd[];
  connectionIdsToRemove: number[];
  /** "No related evidence" checkbox intent. Only honored server-side if the item ends up with zero connections after this same save — see reviewDraftService.saveDraft. */
  noRelatedEvidence: boolean;
  usefulnessOverride: DraftUsefulnessOverride;
  /** Full current notes text; always safe to send. */
  notes: string;
  /** null = "Save & Next" with no decision change; non-null = one of the four decision buttons was used. */
  decisionAction: ReviewDecisionAction | null;
}
