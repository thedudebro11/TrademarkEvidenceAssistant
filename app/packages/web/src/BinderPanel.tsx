import { useState } from "react";
import type { BinderSummary } from "@trademark-evidence-assistant/shared";
import { triggerBinder } from "./api.js";

type BinderState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "complete"; summary: BinderSummary }
  | { phase: "error"; message: string };

/** Presentation only — all binder generation logic lives in BinderService. */
export function BinderPanel() {
  const [state, setState] = useState<BinderState>({ phase: "idle" });

  async function handleGenerate() {
    setState({ phase: "generating" });
    try {
      const summary = await triggerBinder();
      setState({ phase: "complete", summary });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section aria-label="Generate evidence binder">
      <button onClick={() => void handleGenerate()} disabled={state.phase === "generating"}>
        Generate Evidence Binder
      </button>
      <p>
        Builds a factual summary of your most recent evidence package — not legal advice, and not proof of
        trademark rights.
      </p>

      {state.phase === "generating" && <p role="status">Generating your evidence binder…</p>}

      {state.phase === "error" && (
        <p role="alert">
          The binder could not be generated. {state.message} Your original files were not affected.
        </p>
      )}

      {state.phase === "complete" && (
        <div role="status">
          <p>Evidence Binder Generated — {state.summary.itemCount} exhibit{state.summary.itemCount === 1 ? "" : "s"}.</p>
          <p>Location: {state.summary.outputPaths.markdown}</p>
        </div>
      )}
    </section>
  );
}
