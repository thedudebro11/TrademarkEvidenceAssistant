import { useState } from "react";
import type { ScanSummary } from "@trademark-evidence-assistant/shared";
import { triggerScan } from "./api.js";
import { Button } from "./components/ui/Button.js";
import { StatusMessage } from "./components/ui/StatusMessage.js";
import { Badge } from "./components/ui/Badge.js";
import { ScanIcon, SpinnerIcon } from "./components/ui/icons.js";

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
 * triggers the scan and displays whatever state comes back. Visual
 * markup restyled for Evidence Studio (docs/ui/) — text content, roles,
 * and button names kept identical so existing tests still describe real
 * behavior, per docs/ui/UI_COMPONENT_ARCHITECTURE.md "reuse existing
 * feature components."
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
