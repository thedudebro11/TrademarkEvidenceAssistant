import { useState } from "react";
import type { ScanSummary } from "@trademark-evidence-assistant/shared";
import { triggerScan } from "./api.js";

type ScanState =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "complete"; summary: ScanSummary }
  | { phase: "error"; message: string };

interface ScanPanelProps {
  evidenceRootExists: boolean;
  onScanComplete?: () => void;
}

/**
 * Presentation only — all scanning logic lives in ScanService on the
 * server (docs/ARCHITECTURE_CONSTITUTION.md #2). This component just
 * triggers the scan and displays whatever state comes back.
 */
export function ScanPanel({ evidenceRootExists, onScanComplete }: ScanPanelProps) {
  const [state, setState] = useState<ScanState>({ phase: "idle" });

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

  if (!evidenceRootExists) {
    return (
      <p role="status">
        No evidence folder was found for this workspace yet. Nothing can be
        scanned until it exists.
      </p>
    );
  }

  return (
    <section aria-label="Evidence scan">
      <button onClick={handleScan} disabled={state.phase === "scanning"}>
        {state.phase === "complete" ? "Rescan Evidence" : "Begin Scan"}
      </button>

      {state.phase === "scanning" && (
        <p role="status">Scanning your evidence… original files are never modified.</p>
      )}

      {state.phase === "error" && (
        <p role="alert">
          The scan could not finish. {state.message} Your original files were
          not affected.
        </p>
      )}

      {state.phase === "complete" && <ScanSummaryView summary={state.summary} />}
    </section>
  );
}

function ScanSummaryView({ summary }: { summary: ScanSummary }) {
  return (
    <div role="status">
      <p>
        {summary.filesDiscovered} files discovered. Original files remain
        unchanged.
      </p>
      <dl>
        {summary.itemsCreated > 0 && (
          <>
            <dt>New Evidence Items</dt>
            <dd>{summary.itemsCreated}</dd>
          </>
        )}
        {summary.itemsUpdated > 0 && (
          <>
            <dt>Updated</dt>
            <dd>{summary.itemsUpdated}</dd>
          </>
        )}
        {summary.itemsMissing > 0 && (
          <>
            <dt>No longer found on disk</dt>
            <dd>{summary.itemsMissing}</dd>
          </>
        )}
        {summary.duplicateGroups > 0 && (
          <>
            <dt>Exact duplicate groups</dt>
            <dd>{summary.duplicateGroups}</dd>
          </>
        )}
      </dl>
      <p>Evidence items are ready to review.</p>
    </div>
  );
}
