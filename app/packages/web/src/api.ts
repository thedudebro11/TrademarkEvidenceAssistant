import type {
  AnalysisResultResponse,
  ArchiveSimilarApplyRequest,
  ArchiveSimilarApplyResponse,
  ArchiveSimilarPreviewResponse,
  ArchiveSimilarReviewTemplate,
  ArchiveSimilarUndoResponse,
  BinderSummary,
  ConnectionCandidate,
  ConnectionType,
  EvidenceConnection,
  EvidenceItemDetail,
  EvidenceTreeNode,
  EvidenceTypeSuggestion,
  ExportSummary,
  FileRole,
  HeicBackfillJobStatus,
  HeicPreviewInfo,
  MissingRecordsPreviewResponse,
  OcrExtraction,
  RemoveMissingRecordsRequest,
  RemoveMissingRecordsResponse,
  ConfirmAnalysisRequest,
  ConfirmAnalysisResponse,
  BatchAnalysisJobStatus,
  BatchAnalysisSelectionPreview,
  StartBatchAnalysisRequest,
  StartBatchAnalysisResponse,
  SuggestionQueueFilters,
  SuggestionQueueResponse,
  ReviewAnswer,
  ReviewDraftPayload,
  HealthResponse,
  ReviewDecisionAction,
  ReviewProgress,
  ScanSummary,
  SuggestionConfidence,
  UndoMissingRecordsRemovalResponse,
  UsefulnessBand,
  VideoMetadata,
} from "@trademark-evidence-assistant/shared";

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok && res.status !== 503) {
    throw new Error(`Unexpected response fetching health: ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

export async function triggerScan(): Promise<ScanSummary> {
  const res = await fetch("/api/scan", { method: "POST" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Scan failed with status ${res.status}`);
  }
  return body as ScanSummary;
}

export async function triggerExport(): Promise<ExportSummary> {
  const res = await fetch("/api/export", { method: "POST" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Export failed with status ${res.status}`);
  }
  return body as ExportSummary;
}

export async function triggerBinder(): Promise<BinderSummary> {
  const res = await fetch("/api/binder", { method: "POST" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Binder generation failed with status ${res.status}`);
  }
  return body as BinderSummary;
}

export async function fetchConnectionCandidates(excludeId: string): Promise<ConnectionCandidate[]> {
  const res = await fetch(`/api/evidence-items/candidates?exclude=${encodeURIComponent(excludeId)}`);
  if (!res.ok) {
    throw new Error(`Unexpected response fetching connection candidates: ${res.status}`);
  }
  return (await res.json()) as ConnectionCandidate[];
}

export async function fetchEvidenceTree(): Promise<EvidenceTreeNode[]> {
  const res = await fetch("/api/evidence-items/tree");
  if (!res.ok) {
    throw new Error(`Unexpected response fetching the evidence tree: ${res.status}`);
  }
  return (await res.json()) as EvidenceTreeNode[];
}

export async function fetchProgress(): Promise<ReviewProgress> {
  const res = await fetch("/api/evidence-items/progress");
  if (!res.ok) {
    throw new Error(`Unexpected response fetching progress: ${res.status}`);
  }
  return (await res.json()) as ReviewProgress;
}

export async function fetchItem(itemId: string): Promise<EvidenceItemDetail | null> {
  const res = await fetch(`/api/evidence-items/${itemId}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Unexpected response fetching item: ${res.status}`);
  }
  return (await res.json()) as EvidenceItemDetail;
}

export async function fetchNextItem(afterId: string | null): Promise<EvidenceItemDetail | null> {
  const query = afterId ? `?after=${encodeURIComponent(afterId)}` : "";
  const res = await fetch(`/api/evidence-items/next${query}`);
  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Unexpected response fetching next item: ${res.status}`);
  }
  return (await res.json()) as EvidenceItemDetail;
}

export async function fetchPreviousItem(beforeId: string): Promise<EvidenceItemDetail | null> {
  const res = await fetch(`/api/evidence-items/previous?before=${encodeURIComponent(beforeId)}`);
  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Unexpected response fetching previous item: ${res.status}`);
  }
  return (await res.json()) as EvidenceItemDetail;
}

export async function recordDecision(
  itemId: string,
  action: ReviewDecisionAction,
): Promise<EvidenceItemDetail> {
  const res = await fetch(`/api/evidence-items/${itemId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Recording decision failed with status ${res.status}`);
  }
  return body as EvidenceItemDetail;
}

export async function saveItemNotes(itemId: string, notes: string): Promise<{ notesUpdatedAt: string }> {
  const res = await fetch(`/api/evidence-items/${itemId}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Saving notes failed with status ${res.status}`);
  }
  return body as { notesUpdatedAt: string };
}

export function evidenceItemFileUrl(itemId: string): string {
  return `/api/evidence-items/${itemId}/file`;
}

/** Streaming URL for the item's *generated* HEIC/HEIF preview — only ever valid while its status is "ready" (docs/ADR_0005_HEIC_PREVIEWS.md). Never confused with `evidenceItemFileUrl`, which always streams the original file. */
export function heicPreviewFileUrl(itemId: string): string {
  return `/api/evidence-items/${itemId}/heic-preview/file`;
}

export async function fetchHeicPreviewStatus(itemId: string): Promise<HeicPreviewInfo> {
  const res = await fetch(`/api/evidence-items/${itemId}/heic-preview/status`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Fetching HEIC preview status failed with status ${res.status}`);
  }
  return body as HeicPreviewInfo;
}

export interface GenerateHeicPreviewOptions {
  /** "Retry with Alternate Decoder" — forces regeneration with this specific decoder id, regardless of current status. */
  decoderId?: string;
  /** "Regenerate Preview" — forces a fresh attempt with the preferred decoder even if a ready, current preview already exists. Ignored when `decoderId` is set. */
  force?: boolean;
}

/** Triggers (or reuses an in-flight/cached) generation of this item's HEIC preview. Idempotent — safe to call again from a Retry button. */
export async function generateHeicPreview(itemId: string, options: GenerateHeicPreviewOptions = {}): Promise<HeicPreviewInfo> {
  const res = await fetch(`/api/evidence-items/${itemId}/heic-preview/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Generating the HEIC preview failed with status ${res.status}`);
  }
  return body as HeicPreviewInfo;
}

/** Starts a "Generate Missing Previews" backfill job and returns its id immediately — the conversions themselves run on the server in the background, never as one browser request per file. */
export async function triggerHeicPreviewBackfill(): Promise<{ jobId: number }> {
  const res = await fetch("/api/heic-previews/backfill", { method: "POST" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Starting the HEIC preview backfill failed with status ${res.status}`);
  }
  return body as { jobId: number };
}

export async function fetchHeicBackfillStatus(jobId: number): Promise<HeicBackfillJobStatus> {
  const res = await fetch(`/api/heic-previews/backfill/${jobId}`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Fetching backfill status failed with status ${res.status}`);
  }
  return body as HeicBackfillJobStatus;
}

export async function setItemRole(itemId: string, role: FileRole): Promise<EvidenceItemDetail> {
  const res = await fetch(`/api/evidence-items/${itemId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Setting role failed with status ${res.status}`);
  }
  return body as EvidenceItemDetail;
}

export async function saveAnswer(
  itemId: string,
  questionId: string,
  value: string,
  confidence: SuggestionConfidence | null,
  note: string | null,
): Promise<ReviewAnswer> {
  const res = await fetch(`/api/evidence-items/${itemId}/answers/${questionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, confidence, note }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Saving answer failed with status ${res.status}`);
  }
  return body as ReviewAnswer;
}

export async function createConnection(
  itemId: string,
  targetPath: string,
  type: ConnectionType,
  explanation: string,
  confidence: SuggestionConfidence | null,
): Promise<EvidenceConnection> {
  const res = await fetch(`/api/evidence-items/${itemId}/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPath, type, explanation, confidence }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Creating connection failed with status ${res.status}`);
  }
  return body as EvidenceConnection;
}

export async function removeConnection(connectionId: number): Promise<void> {
  const res = await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Removing connection failed with status ${res.status}`);
  }
}

export async function setUsefulnessOverride(
  itemId: string,
  score: number,
  band: UsefulnessBand,
  note: string,
): Promise<EvidenceItemDetail> {
  const res = await fetch(`/api/evidence-items/${itemId}/usefulness-override`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score, band, note }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Setting override failed with status ${res.status}`);
  }
  return body as EvidenceItemDetail;
}

export async function clearUsefulnessOverride(itemId: string): Promise<EvidenceItemDetail> {
  const res = await fetch(`/api/evidence-items/${itemId}/usefulness-override`, { method: "DELETE" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Clearing override failed with status ${res.status}`);
  }
  return body as EvidenceItemDetail;
}

export async function fetchOcrExtraction(itemId: string): Promise<OcrExtraction> {
  const res = await fetch(`/api/evidence-items/${itemId}/ocr`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Text extraction failed with status ${res.status}`);
  }
  return body as OcrExtraction;
}

export async function fetchVideoMetadata(itemId: string): Promise<VideoMetadata> {
  const res = await fetch(`/api/evidence-items/${itemId}/video-metadata`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Fetching video metadata failed with status ${res.status}`);
  }
  return body as VideoMetadata;
}

export async function saveReviewDraft(itemId: string, payload: ReviewDraftPayload): Promise<EvidenceItemDetail> {
  const res = await fetch(`/api/evidence-items/${itemId}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Saving failed with status ${res.status}`);
  }
  return body as EvidenceItemDetail;
}

export async function fetchEvidenceTypeSuggestion(itemId: string): Promise<EvidenceTypeSuggestion | null> {
  const res = await fetch(`/api/evidence-items/${itemId}/evidence-type-suggestion`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Unexpected response fetching evidence-type suggestion: ${res.status}`);
  }
  return (await res.json()) as EvidenceTypeSuggestion;
}

export async function confirmEvidenceType(
  itemId: string,
  typeId: string,
  source: "suggested" | "user",
  confidence: SuggestionConfidence | null,
  reason: string | null,
): Promise<EvidenceItemDetail> {
  const res = await fetch(`/api/evidence-items/${itemId}/evidence-type`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ typeId, source, confidence, reason }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Setting evidence type failed with status ${res.status}`);
  }
  return body as EvidenceItemDetail;
}

export async function saveEvidenceTypeAnswer(
  itemId: string,
  questionId: string,
  value: string,
  confidence: SuggestionConfidence | null,
  note: string | null,
): Promise<ReviewAnswer> {
  const res = await fetch(`/api/evidence-items/${itemId}/evidence-type-answers/${questionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, confidence, note }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Saving answer failed with status ${res.status}`);
  }
  return body as ReviewAnswer;
}

export async function previewArchiveSimilar(
  sourceItemId: string,
  reviewTemplate: ArchiveSimilarReviewTemplate,
): Promise<ArchiveSimilarPreviewResponse> {
  const res = await fetch(`/api/evidence-items/${sourceItemId}/archive-similar/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewTemplate }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Archive Similar preview failed with status ${res.status}`);
  }
  return body as ArchiveSimilarPreviewResponse;
}

export async function applyArchiveSimilar(
  sourceItemId: string,
  request: Omit<ArchiveSimilarApplyRequest, "sourceItemId">,
): Promise<ArchiveSimilarApplyResponse> {
  const res = await fetch(`/api/evidence-items/${sourceItemId}/archive-similar/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Archive Similar apply failed with status ${res.status}`);
  }
  return body as ArchiveSimilarApplyResponse;
}

export async function undoBulkOperation(operationId: number): Promise<ArchiveSimilarUndoResponse> {
  const res = await fetch(`/api/bulk-operations/${operationId}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Undo failed with status ${res.status}`);
  }
  return body as ArchiveSimilarUndoResponse;
}

export async function fetchMissingRecordsPreview(): Promise<MissingRecordsPreviewResponse> {
  const res = await fetch("/api/missing-records/preview");
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Fetching missing records failed with status ${res.status}`);
  }
  return body as MissingRecordsPreviewResponse;
}

export async function removeMissingRecords(request: RemoveMissingRecordsRequest): Promise<RemoveMissingRecordsResponse> {
  const res = await fetch("/api/missing-records/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Removing missing records failed with status ${res.status}`);
  }
  return body as RemoveMissingRecordsResponse;
}

export async function undoMissingRecordsRemoval(operationId: number): Promise<UndoMissingRecordsRemovalResponse> {
  const res = await fetch(`/api/missing-records/${operationId}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Undo failed with status ${res.status}`);
  }
  return body as UndoMissingRecordsRemovalResponse;
}

/** "Analyze Evidence" — starts a new deterministic analysis run for this item. Never writes to any confirmed field — see analysisService.ts. */
export async function analyzeEvidenceItem(itemId: string): Promise<AnalysisResultResponse> {
  const res = await fetch(`/api/evidence-items/${itemId}/analysis`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Analysis failed with status ${res.status}`);
  }
  return body as AnalysisResultResponse;
}

/** The most recent analysis run for this item, if any — never triggers a new one. */
export async function fetchLatestAnalysis(itemId: string): Promise<AnalysisResultResponse | null> {
  const res = await fetch(`/api/evidence-items/${itemId}/analysis`);
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Fetching analysis failed with status ${res.status}`);
  }
  return body as AnalysisResultResponse;
}

export async function confirmAnalysisSuggestions(itemId: string, request: ConfirmAnalysisRequest): Promise<ConfirmAnalysisResponse> {
  const res = await fetch(`/api/evidence-items/${itemId}/analysis/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Confirming analysis failed with status ${res.status}`);
  }
  return body as ConfirmAnalysisResponse;
}

/** A pre-run report for a batch analysis selection (eligible count, folders, file types, unreadable items) without starting anything. */
export async function previewBatchAnalysis(request: StartBatchAnalysisRequest): Promise<BatchAnalysisSelectionPreview> {
  const res = await fetch("/api/analysis/batch/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Previewing the batch selection failed with status ${res.status}`);
  }
  return body as BatchAnalysisSelectionPreview;
}

/** Starts a server-side batch analysis job and returns its id immediately — processing runs on the server in the background, never as one browser request per file. */
export async function startBatchAnalysis(request: StartBatchAnalysisRequest): Promise<StartBatchAnalysisResponse> {
  const res = await fetch("/api/analysis/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Starting the batch analysis job failed with status ${res.status}`);
  }
  return body as StartBatchAnalysisResponse;
}

export async function fetchBatchAnalysisStatus(jobId: number): Promise<BatchAnalysisJobStatus> {
  const res = await fetch(`/api/analysis/batch/${jobId}`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Fetching batch analysis status failed with status ${res.status}`);
  }
  return body as BatchAnalysisJobStatus;
}

export async function cancelBatchAnalysis(jobId: number): Promise<void> {
  const res = await fetch(`/api/analysis/batch/${jobId}/cancel`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? `Canceling the batch analysis job failed with status ${res.status}`);
  }
}

export async function fetchSuggestionsQueue(filters: SuggestionQueueFilters = {}): Promise<SuggestionQueueResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  const res = await fetch(`/api/analysis/suggestions-queue${query ? `?${query}` : ""}`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Fetching the suggestions queue failed with status ${res.status}`);
  }
  return body as SuggestionQueueResponse;
}
