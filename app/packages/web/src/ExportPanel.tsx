import { useState } from "react";
import type { ExportSummary } from "@trademark-evidence-assistant/shared";
import { triggerExport } from "./api.js";
import { Button } from "./components/ui/Button.js";
import { StatusMessage } from "./components/ui/StatusMessage.js";
import { PackageIcon, SpinnerIcon } from "./components/ui/icons.js";

type ExportState =
  | { phase: "idle" }
  | { phase: "exporting" }
  | { phase: "complete"; summary: ExportSummary }
  | { phase: "error"; message: string };

interface ExportPanelProps {
  onExportComplete?: (summary: ExportSummary) => void;
}

/**
 * Presentation only — all copy/hash-verification logic lives in
 * ExportService (docs/ARCHITECTURE_CONSTITUTION.md #2). Restyled for
 * Prepare Package Step 1; text/roles preserved from Phase 7.
 */
export function ExportPanel({ onExportComplete }: ExportPanelProps) {
  const [state, setState] = useState<ExportState>({ phase: "idle" });

  async function handleExport() {
    setState({ phase: "exporting" });
    try {
      const summary = await triggerExport();
      setState({ phase: "complete", summary });
      onExportComplete?.(summary);
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section aria-label="Export evidence package" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p>
        Only files you marked Include will be copied. Original evidence remains untouched — a new,
        organized copy is created separately.
      </p>
      <Button
        variant="primary"
        onClick={() => void handleExport()}
        disabled={state.phase === "exporting"}
        icon={state.phase === "exporting" ? <SpinnerIcon size={18} /> : <PackageIcon size={18} />}
      >
        Generate Evidence Package
      </Button>

      {state.phase === "exporting" && (
        <StatusMessage tone="info">
          Copying included evidence and verifying each copy… original files are never modified.
        </StatusMessage>
      )}

      {state.phase === "error" && (
        <StatusMessage tone="error">
          The export could not finish. {state.message} Your original files were not affected.
        </StatusMessage>
      )}

      {state.phase === "complete" && (
        <StatusMessage tone="success">
          Evidence Package Generated — {state.summary.itemsExported} file
          {state.summary.itemsExported === 1 ? "" : "s"} copied and verified byte-for-byte against the
          originals.
          <br />
          Location: {state.summary.exportPath}
        </StatusMessage>
      )}
    </section>
  );
}
