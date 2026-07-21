import { useRef, useState } from "react";
import type { BatchAnalysisJobStatus, SelectionMode } from "@trademark-evidence-assistant/shared";
import { fetchBatchAnalysisStatus, cancelBatchAnalysis, startBatchAnalysis } from "../../api.js";
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

interface BatchAnalysisPanelProps {
  onReadyForReview?: (jobId: number) => void;
}

export function BatchAnalysisPanel({ onReadyForReview }: BatchAnalysisPanelProps) {
  const [state, setState] = useState<PanelState>({ phase: "idle" });
  const [folderPath, setFolderPath] = useState("");
  const [selectedIdsText, setSelectedIdsText] = useState("");
  const cancelledRef = useRef(false);

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
      if (!cancelledRef.current && job.readyForReview) onReadyForReview?.(job.id);
    } catch (err) {
      if (!cancelledRef.current) setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function handleSelectedIds() {
    const itemIds = selectedIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (itemIds.length === 0) return;
    void runJob({ selectionMode: "selected_ids", itemIds });
  }

  function handleFolder() {
    if (!folderPath.trim()) return;
    void runJob({ selectionMode: "folder", folderPath: folderPath.trim() });
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
        <label htmlFor="batch-folder-path">Folder</label>
        <input id="batch-folder-path" type="text" value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="e.g. Customer Photos" disabled={busy} />
        <Button variant="secondary" disabled={busy} onClick={handleFolder}>
          Analyze Folder
        </Button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <label htmlFor="batch-selected-ids">Selected item ids</label>
        <textarea id="batch-selected-ids" value={selectedIdsText} onChange={(e) => setSelectedIdsText(e.target.value)} rows={2} placeholder="paste item ids, comma or newline separated" disabled={busy} />
        <Button variant="secondary" disabled={busy} onClick={handleSelectedIds}>
          Analyze Selected
        </Button>
      </div>

      {state.phase === "running" && (
        <StatusMessage tone="info">
          <span role="status">
            Analyzing… {state.job.processedCount} of {state.job.totalCount} processed
            {state.job.currentItemId ? ` (current: ${state.job.currentItemId})` : ""}. Succeeded {state.job.succeededCount}, failed {state.job.failedCount}, skipped {state.job.skippedCount}.
          </span>
          <div>
            <Button variant="secondary" onClick={() => void handleCancel()}>
              Cancel
            </Button>
          </div>
        </StatusMessage>
      )}

      {state.phase === "error" && <StatusMessage tone="error">The batch analysis job could not be started or tracked. {state.message}</StatusMessage>}

      {state.phase === "done" && <JobSummary job={state.job} onRetryFailed={RETRYABLE_STATUSES.has(state.job.status) && state.job.failedCount > 0 ? handleRetryFailed : undefined} />}
    </section>
  );
}

function JobSummary({ job, onRetryFailed }: { job: BatchAnalysisJobStatus; onRetryFailed?: () => void }) {
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
        {job.readyForReview && <p role="status">Ready for review — {job.succeededCount} item(s) have staged suggestions waiting.</p>}
        {onRetryFailed && (
          <div>
            <Button variant="secondary" onClick={onRetryFailed}>
              Retry Failed Items
            </Button>
          </div>
        )}
      </div>
    </StatusMessage>
  );
}
