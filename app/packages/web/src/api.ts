import type {
  BinderSummary,
  ConnectionType,
  EvidenceConnection,
  EvidenceItemDetail,
  ExportSummary,
  FileRole,
  ReviewAnswer,
  HealthResponse,
  ReviewDecisionAction,
  ReviewProgress,
  ScanSummary,
  SuggestionConfidence,
  UsefulnessBand,
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
