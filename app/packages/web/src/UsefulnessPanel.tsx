import { useState } from "react";
import {
  USEFULNESS_BANDS,
  type DraftUsefulnessOverride,
  type EvidenceItemDetail,
  type UsefulnessBand,
} from "@trademark-evidence-assistant/shared";

interface UsefulnessPanelProps {
  item: EvidenceItemDetail;
  draftOverride: DraftUsefulnessOverride;
  onSetOverride: (score: number, band: UsefulnessBand, note: string) => void;
  onRemoveOverride: () => void;
}

/**
 * Always shows the computed score's reasoning even when an override is
 * staged — docs/DESIGN_LANGUAGE.md: "the application never hides ... why
 * something scored highly." Never claims legal sufficiency (spec 08).
 *
 * The override *value* (once submitted) lives in the parent Review
 * Draft (`draftOverride`), surviving this panel unmounting on accordion
 * collapse. The open/closed state of the edit form itself is local,
 * transient UI state — an unsubmitted, in-progress form isn't a valid
 * override to stage (same reasoning as ConnectionsPanel's add-form).
 */
export function UsefulnessPanel({ item, draftOverride, onSetOverride, onRemoveOverride }: UsefulnessPanelProps) {
  const [overriding, setOverriding] = useState(false);
  const [score, setScore] = useState(String(item.usefulness.effective.score));
  const [band, setBand] = useState<UsefulnessBand>(item.usefulness.effective.band);
  const [note, setNote] = useState("");

  const { computed, override, effective } = item.usefulness;
  const pendingSet = draftOverride.action === "set" ? draftOverride : null;
  const pendingClear = draftOverride.action === "clear";

  function handleSubmitOverride(e: React.FormEvent) {
    e.preventDefault();
    onSetOverride(Number(score), band, note);
    setOverriding(false);
    setNote("");
  }

  return (
    <div aria-label="Usefulness assessment">
      <p>
        <strong>{effective.band}</strong> ({effective.score}/100) — an organizational aid only, not a legal
        conclusion.
      </p>

      {pendingSet && (
        <p role="status">
          Pending override (not yet saved): {pendingSet.band} ({pendingSet.score}/100). Reason: {pendingSet.note}
          <button onClick={onRemoveOverride}>Undo pending override</button>
        </p>
      )}

      {!pendingSet && pendingClear && (
        <p role="status">
          The existing override will be removed when you save. <button onClick={onRemoveOverride}>Undo</button>
        </p>
      )}

      {!pendingSet && !pendingClear && override && (
        <p role="status">
          This is a manual override. Reason: {override.note}
          <button onClick={onRemoveOverride}>Remove override</button>
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

      {!overriding && <button onClick={() => setOverriding(true)}>Override this score</button>}

      {overriding && (
        <form onSubmit={handleSubmitOverride}>
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
          <button type="submit" disabled={!note.trim()}>
            Save Override
          </button>
          <button type="button" onClick={() => setOverriding(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
