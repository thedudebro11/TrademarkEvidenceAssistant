import { useState } from "react";
import type { BinderSummary } from "@trademark-evidence-assistant/shared";
import { triggerBinder } from "./api.js";
import { Button } from "./components/ui/Button.js";
import { StatusMessage } from "./components/ui/StatusMessage.js";
import { NoteIcon, SpinnerIcon } from "./components/ui/icons.js";

type BinderState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "complete"; summary: BinderSummary }
  | { phase: "error"; message: string };

/**
 * Presentation only — all binder generation logic lives in
 * BinderService. Restyled for Prepare Package Step 2; text/roles
 * preserved from Phase 8. The server itself refuses to generate a
 * binder without a completed export and explains why (see the error
 * branch below) — that real validation is the availability gate, rather
 * than a client-side guess at state this page has no way to verify.
 */
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
    <section aria-label="Generate evidence binder" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p>
        Builds a factual summary of your most recent evidence package — not legal advice, and not proof of
        trademark rights.
      </p>
      <Button
        variant="primary"
        onClick={() => void handleGenerate()}
        disabled={state.phase === "generating"}
        icon={state.phase === "generating" ? <SpinnerIcon size={18} /> : <NoteIcon size={18} />}
      >
        Generate Evidence Binder
      </Button>

      {state.phase === "generating" && <StatusMessage tone="info">Generating your evidence binder…</StatusMessage>}

      {state.phase === "error" && (
        <StatusMessage tone="error">
          The binder could not be generated. {state.message} Your original files were not affected.
        </StatusMessage>
      )}

      {state.phase === "complete" && (
        <StatusMessage tone="success">
          Evidence Binder Generated — {state.summary.itemCount} exhibit{state.summary.itemCount === 1 ? "" : "s"}.
          <br />
          Location: {state.summary.outputPaths.markdown}
        </StatusMessage>
      )}
    </section>
  );
}
