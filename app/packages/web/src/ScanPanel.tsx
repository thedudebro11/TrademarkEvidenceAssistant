import { useRef, useState } from "react";
import type { HeicBackfillJobStatus, ScanSummary } from "@trademark-evidence-assistant/shared";
import { fetchHeicBackfillStatus, triggerHeicPreviewBackfill, triggerScan } from "./api.js";
import { Button } from "./components/ui/Button.js";
import { StatusMessage } from "./components/ui/StatusMessage.js";
import { Badge } from "./components/ui/Badge.js";
import { ScanIcon, SpinnerIcon } from "./components/ui/icons.js";

type ScanState =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "complete"; summary: ScanSummary }
  | { phase: "error"; message: string };

type BackfillState =
  | { phase: "idle" }
  | { phase: "running"; job: HeicBackfillJobStatus }
  | { phase: "done"; job: HeicBackfillJobStatus }
  | { phase: "error"; message: string };

const BACKFILL_POLL_INTERVAL_MS = 1500;

/** Statuses a poller should keep waiting through — everything else is terminal. Matches HeicBackfillJobStatus["status"] in shared/models.ts. */
const ACTIVE_BACKFILL_STATUSES = new Set<HeicBackfillJobStatus["status"]>(["queued", "running"]);

/** Terminal statuses that mean "something didn't fully succeed" — shown with a Retry action rather than a plain success message. */
const RETRYABLE_BACKFILL_STATUSES = new Set<HeicBackfillJobStatus["status"]>(["failed", "interrupted", "completed_with_failures"]);

interface ScanPanelProps {
  evidenceRootExists: boolean;
  onScanComplete?: () => void;
}

/**
 * Presentation only — all scanning logic lives in ScanService on the
 * server (docs/ARCHITECTURE_CONSTITUTION.md #2). This component just
 * triggers the scan and displays whatever state comes back. Visual
 * markup restyled for Evidence Studio (docs/ui/) — text content, roles,
 * and button names kept identical so existing tests still describe real
 * behavior, per docs/ui/UI_COMPONENT_ARCHITECTURE.md "reuse existing
 * feature components."
 */
export function ScanPanel({ evidenceRootExists, onScanComplete }: ScanPanelProps) {
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const [backfillState, setBackfillState] = useState<BackfillState>({ phase: "idle" });
  const backfillCancelledRef = useRef(false);

  async function handleScan() {
    setState({ phase: "scanning" });
    try {
      const summary = await triggerScan();
      setState({ phase: "complete", summary });
      onScanComplete?.();
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * "Generate Missing Previews" — one request starts (or, per the
   * server's own duplicate-prevention, reuses an already-active) backfill
   * job (docs/ADR_0005_HEIC_PREVIEWS.md), then this polls that job's own
   * progress endpoint rather than issuing one browser request per HEIC
   * file; the actual conversions run on the server in the background.
   *
   * The job can already be in a terminal state by the time the *first*
   * status fetch resolves — guaranteed, in fact, whenever there is
   * nothing left to do (every candidate already has a current preview),
   * since the server's background work then finishes synchronously fast
   * enough to beat the round trip back to the browser. The phase after
   * every fetch — including this first one — is always derived from the
   * job's actual status, never assumed to be "running": that's what
   * previously left this stuck on "0 of N processed" forever whenever a
   * job finished before the loop below ever got to run.
   */
  async function handleBackfill() {
    backfillCancelledRef.current = false;
    try {
      const { jobId } = await triggerHeicPreviewBackfill();
      let job = await fetchHeicBackfillStatus(jobId);
      setBackfillState({ phase: ACTIVE_BACKFILL_STATUSES.has(job.status) ? "running" : "done", job });
      while (!backfillCancelledRef.current && ACTIVE_BACKFILL_STATUSES.has(job.status)) {
        await new Promise((resolve) => setTimeout(resolve, BACKFILL_POLL_INTERVAL_MS));
        job = await fetchHeicBackfillStatus(jobId);
        if (!backfillCancelledRef.current) setBackfillState({ phase: ACTIVE_BACKFILL_STATUSES.has(job.status) ? "running" : "done", job });
      }
    } catch (err) {
      if (!backfillCancelledRef.current) {
        setBackfillState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  if (!evidenceRootExists) {
    return (
      <p role="status">
        No evidence folder was found for this workspace yet. Nothing can be
        scanned until it exists.
      </p>
    );
  }

  return (
    <section aria-label="Evidence scan" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Button
        variant="primary"
        onClick={handleScan}
        disabled={state.phase === "scanning"}
        icon={state.phase === "scanning" ? <SpinnerIcon size={18} /> : <ScanIcon size={18} />}
      >
        {state.phase === "complete" ? "Rescan Evidence" : "Begin Scan"}
      </Button>

      {state.phase === "scanning" && (
        <StatusMessage tone="info">
          <span role="status">Scanning your evidence… original files are never modified.</span>
        </StatusMessage>
      )}

      {state.phase === "error" && (
        <StatusMessage tone="error">
          The scan could not finish. {state.message} Your original files were
          not affected.
        </StatusMessage>
      )}

      {state.phase === "complete" && <ScanSummaryView summary={state.summary} />}

      <Button
        variant="secondary"
        onClick={() => void handleBackfill()}
        disabled={backfillState.phase === "running"}
        icon={backfillState.phase === "running" ? <SpinnerIcon size={18} /> : undefined}
      >
        Generate Missing Previews
      </Button>

      {backfillState.phase === "running" && (
        <StatusMessage tone="info">
          <span role="status">
            Generating HEIC previews… {backfillState.job.processedCount} of {backfillState.job.totalCount} processed.
          </span>
        </StatusMessage>
      )}
      {backfillState.phase === "done" && (
        <>
          <StatusMessage tone={RETRYABLE_BACKFILL_STATUSES.has(backfillState.job.status) ? "warning" : "success"}>
            <span role="status">
              {backfillState.job.succeededCount} preview{backfillState.job.succeededCount === 1 ? "" : "s"} generated
              {backfillState.job.failedCount > 0 ? `, ${backfillState.job.failedCount} failed` : ""}
              {backfillState.job.skippedCount > 0 ? ` (${backfillState.job.skippedCount} already had a current preview)` : ""}
              {backfillState.job.status === "interrupted" ? " — interrupted before it could finish" : ""}.
              {backfillState.job.errorMessage ? ` ${backfillState.job.errorMessage}` : ""}
            </span>
          </StatusMessage>
          {RETRYABLE_BACKFILL_STATUSES.has(backfillState.job.status) && (
            <Button variant="secondary" onClick={() => void handleBackfill()}>
              Retry
            </Button>
          )}
        </>
      )}
      {backfillState.phase === "error" && <StatusMessage tone="error">Could not generate missing previews. {backfillState.message}</StatusMessage>}
    </section>
  );
}

function ScanSummaryView({ summary }: { summary: ScanSummary }) {
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p>
        {summary.filesDiscovered} files discovered. Original files remain
        unchanged.
      </p>
      <dl style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {summary.itemsCreated > 0 && (
          <>
            <dt className="visually-hidden">New Evidence Items</dt>
            <dd>
              <Badge tone="info">{summary.itemsCreated} new</Badge>
            </dd>
          </>
        )}
        {summary.itemsUpdated > 0 && (
          <>
            <dt className="visually-hidden">Updated</dt>
            <dd>
              <Badge tone="info">{summary.itemsUpdated} updated</Badge>
            </dd>
          </>
        )}
        {summary.itemsMissing > 0 && (
          <>
            <dt className="visually-hidden">No longer found on disk</dt>
            <dd>
              <Badge tone="warning">{summary.itemsMissing} missing</Badge>
            </dd>
          </>
        )}
        {summary.duplicateGroups > 0 && (
          <>
            <dt className="visually-hidden">Exact duplicate groups</dt>
            <dd>
              <Badge tone="neutral">{summary.duplicateGroups} duplicate groups</Badge>
            </dd>
          </>
        )}
      </dl>
      <p>Evidence items are ready to review.</p>
    </div>
  );
}
