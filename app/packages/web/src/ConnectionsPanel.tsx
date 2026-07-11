import { useState } from "react";
import {
  CONNECTION_TYPES,
  SUGGESTION_CONFIDENCES,
  type ConnectionType,
  type EvidenceItemDetail,
  type SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import { createConnection, removeConnection } from "./api.js";

interface ConnectionsPanelProps {
  item: EvidenceItemDetail;
  onChanged: (updated: EvidenceItemDetail) => void;
  refetchItem: () => Promise<EvidenceItemDetail | null>;
}

/**
 * Presentation only. Renders simple evidence chains per spec 07 ("no
 * complex graph in v1") — a flat list, not a visualization. Target items
 * are identified by original path rather than a search/picker UI, which
 * spec 07's "no complex graph" scope doesn't call for building.
 */
export function ConnectionsPanel({ item, onChanged, refetchItem }: ConnectionsPanelProps) {
  const [targetPath, setTargetPath] = useState("");
  const [type, setType] = useState<ConnectionType>("related_to");
  const [explanation, setExplanation] = useState("");
  const [confidence, setConfidence] = useState<SuggestionConfidence | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createConnection(item.id, targetPath.trim(), type, explanation.trim(), confidence || null);
      const refreshed = await refetchItem();
      if (refreshed) onChanged(refreshed);
      setTargetPath("");
      setExplanation("");
      setConfidence("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(connectionId: number) {
    setBusy(true);
    try {
      await removeConnection(connectionId);
      const refreshed = await refetchItem();
      if (refreshed) onChanged(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-label="Evidence connections">
      {item.connections.length === 0 ? (
        <p>No related evidence has been linked yet.</p>
      ) : (
        <ul>
          {item.connections.map((c) => (
            <li key={c.connectionId}>
              <span>{c.direction === "outgoing" ? "Supports →" : "← Supported by"}</span>{" "}
              <span>{c.relatedOriginalPath}</span> <span>({c.type.replace(/_/g, " ")})</span>
              <p>{c.explanation}</p>
              <button onClick={() => void handleRemove(c.connectionId)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void handleAdd(e)}>
        <label htmlFor="connection-target-path">Related file's path</label>
        <input
          id="connection-target-path"
          value={targetPath}
          onChange={(e) => setTargetPath(e.target.value)}
          placeholder="e.g. Proof Files/invoice.pdf"
          required
        />

        <label htmlFor="connection-type">Relationship type</label>
        <select id="connection-type" value={type} onChange={(e) => setType(e.target.value as ConnectionType)}>
          {CONNECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <label htmlFor="connection-explanation">Why are these connected?</label>
        <input
          id="connection-explanation"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          required
        />

        <label htmlFor="connection-confidence">Confidence</label>
        <select
          id="connection-confidence"
          value={confidence}
          onChange={(e) => setConfidence(e.target.value as SuggestionConfidence | "")}
        >
          <option value="">Not set</option>
          {SUGGESTION_CONFIDENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <button type="submit" disabled={busy || !targetPath.trim() || !explanation.trim()}>
          Link Evidence
        </button>
      </form>

      {error && <p role="alert">{error} Your original files were not affected.</p>}
    </div>
  );
}
