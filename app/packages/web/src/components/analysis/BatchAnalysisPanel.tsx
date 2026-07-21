import { useEffect, useMemo, useRef, useState } from "react";
import type { BatchAnalysisJobStatus, EvidenceTreeNode } from "@trademark-evidence-assistant/shared";
import { fetchBatchAnalysisStatus, cancelBatchAnalysis, fetchEvidenceTree, startBatchAnalysis } from "../../api.js";
import { Button } from "../ui/Button.js";
import { StatusMessage } from "../ui/StatusMessage.js";
import { Badge } from "../ui/Badge.js";
import { SpinnerIcon } from "../ui/icons.js";

/**
 * Evidence Intelligence Phase 2 — server-side batch analysis. Presentation
 * only, same convention as ScanPanel.tsx's HEIC backfill trigger: one
 * request starts (or reuses) a job, then this polls that job's own
 * progress endpoint rather than issuing one browser request per file —
 * the actual analysis runs on the server in the background. Every phase
 * shown below is read directly from the job's real `status`, never
 * assumed.
 */

const POLL_INTERVAL_MS = 1000;
const ACTIVE_STATUSES = new Set<BatchAnalysisJobStatus["status"]>(["queued", "running"]);
const RETRYABLE_STATUSES = new Set<BatchAnalysisJobStatus["status"]>(["failed", "interrupted", "completed_with_failures"]);

type PanelState = { phase: "idle" } | { phase: "running"; job: BatchAnalysisJobStatus } | { phase: "done"; job: BatchAnalysisJobStatus } | { phase: "error"; message: string };

interface FlatFile {
  id: string;
  name: string;
  folder: string;
}

/** Walks the evidence tree once into a flat file list (with each file's real folder path) — powers both the folder picker and the searchable item picker, no server change needed. */
function flattenTree(nodes: EvidenceTreeNode[], folderPath = ""): FlatFile[] {
  const files: FlatFile[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      files.push({ id: node.id, name: node.name, folder: folderPath });
    } else {
      files.push(...flattenTree(node.children, folderPath ? `${folderPath}/${node.name}` : node.name));
    }
  }
  return files;
}

interface BatchAnalysisPanelProps {
  onReadyForReview?: (jobId: number) => void;
}

export function BatchAnalysisPanel({ onReadyForReview }: BatchAnalysisPanelProps) {
  const [state, setState] = useState<PanelState>({ phase: "idle" });
  const [folderPath, setFolderPath] = useState("");
  const [files, setFiles] = useState<FlatFile[] | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedIdsText, setSelectedIdsText] = useState("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    fetchEvidenceTree()
      .then((tree) => setFiles(flattenTree(tree)))
      .catch(() => setFiles([]));
  }, []);

  const folders = useMemo(() => {
    if (!files) return [];
    return [...new Set(files.map((f) => f.folder).filter(Boolean))].sort();
  }, [files]);

  const pickerResults = useMemo(() => {
    if (!files || !pickerQuery.trim()) return [];
    const q = pickerQuery.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)).slice(0, 25);
  }, [files, pickerQuery]);

  async function runJob(request: Parameters<typeof startBatchAnalysis>[0]) {
    cancelledRef.current = false;
    try {
      const { jobId } = await startBatchAnalysis(request);
      let job = await fetchBatchAnalysisStatus(jobId);
      setState({ phase: ACTIVE_STATUSES.has(job.status) ? "running" : "done", job });
      while (!cancelledRef.current && ACTIVE_STATUSES.has(job.status)) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        job = await fetchBatchAnalysisStatus(jobId);
        if (!cancelledRef.current) setState({ phase: ACTIVE_STATUSES.has(job.status) ? "running" : "done", job });
      }
    } catch (err) {
      if (!cancelledRef.current) setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAnalyzePicked() {
    const itemIds = [...selectedIds];
    if (itemIds.length === 0) return;
    void runJob({ selectionMode: "selected_ids", itemIds });
  }

  function handleAnalyzeAdvancedIds() {
    const itemIds = selectedIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (itemIds.length === 0) return;
    void runJob({ selectionMode: "selected_ids", itemIds });
  }

  function handleFolder() {
    if (!folderPath) return;
    void runJob({ selectionMode: "folder", folderPath });
  }

  async function handleCancel() {
    if (state.phase !== "running") return;
    await cancelBatchAnalysis(state.job.id);
  }

  function handleRetryFailed() {
    if (state.phase !== "done") return;
    void runJob({ selectionMode: "retry_failed", sourceJobId: state.job.id });
  }

  const busy = state.phase === "running";

  return (
    <section aria-label="Batch analysis" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Button variant="primary" disabled={busy} onClick={() => void runJob({ selectionMode: "all_unreviewed" })} icon={busy ? <SpinnerIcon size={18} /> : undefined}>
          Analyze All Unreviewed
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void runJob({ selectionMode: "stale" })}>
          Reanalyze Stale
        </Button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="batch-folder-select">Folder</label>
        <select id="batch-folder-select" value={folderPath} onChange={(e) => setFolderPath(e.target.value)} disabled={busy || folders.length === 0}>
          <option value="">Choose a folder…</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <Button variant="secondary" disabled={busy || !folderPath} onClick={handleFolder}>
          Analyze Folder
        </Button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label htmlFor="batch-item-picker">Find items to analyze</label>
        <input
          id="batch-item-picker"
          type="text"
          value={pickerQuery}
          onChange={(e) => setPickerQuery(e.target.value)}
          placeholder="Search by filename or folder…"
          disabled={busy}
          style={{ maxWidth: 420 }}
        />
        {pickerResults.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-neutral, #33333340)", borderRadius: 8 }}>
            {pickerResults.map((f) => (
              <li key={f.id}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedIds.has(f.id)} onChange={() => toggleSelected(f.id)} disabled={busy} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${f.folder ? f.folder + "/" : ""}${f.name}`}>
                    {f.name} <small style={{ color: "var(--text-secondary)" }}>{f.folder}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {selectedIds.size > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>{selectedIds.size} item(s) selected</span>
            <Button variant="secondary" disabled={busy} onClick={handleAnalyzePicked}>
              Analyze Selected
            </Button>
            <Button variant="tertiary" disabled={busy} onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </Button>
          </div>
        )}
      </div>

      <details open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer" }}>Advanced: analyze specific item IDs</summary>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", marginTop: 8 }}>
          <label htmlFor="batch-selected-ids">Item ids</label>
          <textarea id="batch-selected-ids" value={selectedIdsText} onChange={(e) => setSelectedIdsText(e.target.value)} rows={2} placeholder="paste item ids, comma or newline separated" disabled={busy} />
          <Button variant="tertiary" disabled={busy} onClick={handleAnalyzeAdvancedIds}>
            Analyze These IDs
          </Button>
        </div>
      </details>

      {state.phase === "running" && (
        <StatusMessage tone="info">
          <span role="status">
            Analyzing {state.job.currentFilename ?? "…"}
            {state.job.currentFolder ? ` in ${state.job.currentFolder}` : ""} — {state.job.processedCount} of {state.job.totalCount} processed. Succeeded {state.job.succeededCount}, failed{" "}
            {state.job.failedCount}, skipped {state.job.skippedCount}.
          </span>
          <div>
            <Button variant="secondary" onClick={() => void handleCancel()}>
              Cancel
            </Button>
          </div>
        </StatusMessage>
      )}

      {state.phase === "error" && <StatusMessage tone="error">The batch analysis job could not be started or tracked. {state.message}</StatusMessage>}

      {state.phase === "done" && (
        <JobSummary
          job={state.job}
          onRetryFailed={RETRYABLE_STATUSES.has(state.job.status) && state.job.failedCount > 0 ? handleRetryFailed : undefined}
          onOpenReviewQueue={onReadyForReview ? () => onReadyForReview(state.job.id) : undefined}
        />
      )}
    </section>
  );
}

function JobSummary({ job, onRetryFailed, onOpenReviewQueue }: { job: BatchAnalysisJobStatus; onRetryFailed?: () => void; onOpenReviewQueue?: () => void }) {
  const tone = job.status === "completed" ? "success" : job.status === "canceled" ? "neutral" : "warning";
  return (
    <StatusMessage tone={tone === "success" ? "success" : tone === "warning" ? "error" : "info"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Badge tone={tone}>{job.status.replace(/_/g, " ")}</Badge>
          <span>
            {job.totalCount} total · {job.succeededCount} succeeded · {job.failedCount} failed · {job.skippedCount} skipped
          </span>
        </div>
        {job.errorSummary && <p>{job.errorSummary}</p>}
        {job.status === "interrupted" && <p role="status">This job was interrupted (the server restarted while it was running). Start it again to pick up where it left off.</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {job.readyForReview && onOpenReviewQueue && (
            <Button variant="primary" onClick={onOpenReviewQueue}>
              Review {job.succeededCount} Suggestion{job.succeededCount === 1 ? "" : "s"}
            </Button>
          )}
          {onRetryFailed && (
            <Button variant="secondary" onClick={onRetryFailed}>
              Retry Failed Items
            </Button>
          )}
        </div>
      </div>
    </StatusMessage>
  );
}
