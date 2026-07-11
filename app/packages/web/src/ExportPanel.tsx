import { useState } from "react";
import type { ExportSummary } from "@trademark-evidence-assistant/shared";
import { triggerExport } from "./api.js";

type ExportState =
  | { phase: "idle" }
  | { phase: "exporting" }
  | { phase: "complete"; summary: ExportSummary }
  | { phase: "error"; message: string };

/**
 * Presentation only — all copy/hash-verification logic lives in
 * ExportService (docs/ARCHITECTURE_CONSTITUTION.md #2).
 */
export function ExportPanel() {
  const [state, setState] = useState<ExportState>({ phase: "idle" });

  async function handleExport() {
    setState({ phase: "exporting" });
    try {
      const summary = await triggerExport();
      setState({ phase: "complete", summary });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section aria-label="Export evidence package">
      <button onClick={() => void handleExport()} disabled={state.phase === "exporting"}>
        Generate Evidence Package
      </button>
      <p>
        Only files you marked Include will be copied. Original evidence remains untouched — a new,
        organized copy is created separately.
      </p>

      {state.phase === "exporting" && (
        <p role="status">Copying included evidence and verifying each copy… original files are never modified.</p>
      )}

      {state.phase === "error" && (
        <p role="alert">
          The export could not finish. {state.message} Your original files were not affected.
        </p>
      )}

      {state.phase === "complete" && (
        <div role="status">
          <p>
            Evidence Package Generated — {state.summary.itemsExported} file
            {state.summary.itemsExported === 1 ? "" : "s"} copied and verified byte-for-byte against the
            originals.
          </p>
          <p>Location: {state.summary.exportPath}</p>
        </div>
      )}
    </section>
  );
}
