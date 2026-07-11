import { useState } from "react";
import {
  USEFULNESS_BANDS,
  type EvidenceItemDetail,
  type UsefulnessBand,
} from "@trademark-evidence-assistant/shared";
import { clearUsefulnessOverride, setUsefulnessOverride } from "./api.js";

interface UsefulnessPanelProps {
  item: EvidenceItemDetail;
  onChanged: (updated: EvidenceItemDetail) => void;
}

/**
 * Presentation only. Always shows the computed score's reasoning even
 * when an override is active — docs/DESIGN_LANGUAGE.md: "the application
 * never hides ... why something scored highly." Never claims legal
 * sufficiency (spec 08) — the copy here only ever says "organizational
 * aid," matching the disclaimer language used throughout the app.
 */
export function UsefulnessPanel({ item, onChanged }: UsefulnessPanelProps) {
  const [overriding, setOverriding] = useState(false);
  const [score, setScore] = useState(String(item.usefulness.effective.score));
  const [band, setBand] = useState<UsefulnessBand>(item.usefulness.effective.band);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { computed, override, effective } = item.usefulness;

  async function handleSubmitOverride(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const updated = await setUsefulnessOverride(item.id, Number(score), band, note);
      onChanged(updated);
      setOverriding(false);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearOverride() {
    setBusy(true);
    try {
      const updated = await clearUsefulnessOverride(item.id);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-label="Usefulness assessment">
      <p>
        <strong>{effective.band}</strong> ({effective.score}/100) — an organizational aid only, not a legal
        conclusion.
      </p>

      {override && (
        <p role="status">
          This is a manual override. Reason: {override.note}
          <button onClick={() => void handleClearOverride()} disabled={busy}>
            Remove override
          </button>
        </p>
      )}

      <div aria-label="Computed score reasoning">
        <p>Computed score: {computed.score}/100 ({computed.band})</p>
        {computed.positiveFactors.length > 0 && (
          <ul>
            {computed.positiveFactors.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {computed.missingElements.length > 0 && (
          <>
            <p>Missing:</p>
            <ul>
              {computed.missingElements.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {!overriding && (
        <button onClick={() => setOverriding(true)} disabled={busy}>
          Override this score
        </button>
      )}

      {overriding && (
        <form onSubmit={(e) => void handleSubmitOverride(e)}>
          <label htmlFor="override-score">Score (0-100)</label>
          <input
            id="override-score"
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
          <label htmlFor="override-band">Band</label>
          <select id="override-band" value={band} onChange={(e) => setBand(e.target.value as UsefulnessBand)}>
            {USEFULNESS_BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <label htmlFor="override-note">Why are you overriding the computed score?</label>
          <input id="override-note" value={note} onChange={(e) => setNote(e.target.value)} required />
          <button type="submit" disabled={busy || !note.trim()}>
            Save Override
          </button>
          <button type="button" onClick={() => setOverriding(false)} disabled={busy}>
            Cancel
          </button>
        </form>
      )}

      {error && <p role="alert">{error} Your original files were not affected.</p>}
    </div>
  );
}
