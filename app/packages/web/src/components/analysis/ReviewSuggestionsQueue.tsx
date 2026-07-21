import { useEffect, useState } from "react";
import type { SuggestionConfidence, SuggestionQueueFilters, SuggestionQueueItemView } from "@trademark-evidence-assistant/shared";
import { fetchSuggestionsQueue } from "../../api.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
import { StatusMessage } from "../ui/StatusMessage.js";
import { setPendingReviewItemId, useRouter } from "../../app/router.js";

/**
 * Evidence Intelligence Phase 2 — the Review Suggestions queue. Every
 * item shown here still has unconfirmed, staged suggestions; opening one
 * navigates to the existing Review page and reuses the existing
 * AnalysisPanel (Phase 1) — this component never itself confirms
 * anything, and does not offer mass confirmation, per the phase's scope.
 */

interface ReviewSuggestionsQueueProps {
  /** Scope to one batch job's items, or omit for every item with pending suggestions workspace-wide. */
  jobId?: number;
  onClose?: () => void;
}

const CONFIDENCE_OPTIONS: SuggestionConfidence[] = ["low", "medium", "high"];

export function ReviewSuggestionsQueue({ jobId, onClose }: ReviewSuggestionsQueueProps) {
  const { navigate } = useRouter();
  const [filters, setFilters] = useState<Omit<SuggestionQueueFilters, "jobId">>({});
  const [items, setItems] = useState<SuggestionQueueItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchSuggestionsQueue({ ...filters, jobId })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [filters, jobId]);

  function toggle<K extends keyof Omit<SuggestionQueueFilters, "jobId">>(key: K) {
    setFilters((prev) => ({ ...prev, [key]: prev[key] ? undefined : true }));
  }

  function openItem(item: SuggestionQueueItemView) {
    setPendingReviewItemId(item.evidenceItemId);
    navigate("/review");
  }

  return (
    <section aria-label="Review Suggestions queue" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Review Suggestions</h3>
        {onClose && (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <input
          type="text"
          aria-label="Filter by folder"
          placeholder="Folder"
          value={filters.folder ?? ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, folder: e.target.value || undefined }))}
        />
        <input
          type="text"
          aria-label="Filter by evidence type"
          placeholder="Evidence type"
          value={filters.evidenceType ?? ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, evidenceType: e.target.value || undefined }))}
        />
        <select
          aria-label="Minimum confidence"
          value={filters.minConfidence ?? ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, minConfidence: (e.target.value || undefined) as SuggestionConfidence | undefined }))}
        >
          <option value="">Any confidence</option>
          {CONFIDENCE_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}+
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={Boolean(filters.unresolvedCustomerStatus)} onChange={() => toggle("unresolvedCustomerStatus")} /> Unresolved customer status
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.hasContradiction)} onChange={() => toggle("hasContradiction")} /> Contradiction
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.hasConnections)} onChange={() => toggle("hasConnections")} /> Has connection suggestions
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.failedExtraction)} onChange={() => toggle("failedExtraction")} /> Failed extraction
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.stale)} onChange={() => toggle("stale")} /> Stale
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.noProvider)} onChange={() => toggle("noProvider")} /> No provider available
        </label>
      </div>

      {error && <StatusMessage tone="error">Could not load the suggestions queue. {error}</StatusMessage>}

      {items && items.length === 0 && <p role="status">No items match these filters.</p>}

      {items && items.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => (
            <li key={item.evidenceItemId}>
              <button
                type="button"
                onClick={() => openItem(item)}
                style={{ width: "100%", textAlign: "left", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", cursor: "pointer" }}
              >
                <strong>{item.filename}</strong>
                <span>{item.folder || "(root)"}</span>
                {item.suggestedEvidenceType && <Badge tone="info">{item.suggestedEvidenceType.replace(/_/g, " ")}</Badge>}
                {item.confidence && <Badge tone="neutral">{item.confidence}</Badge>}
                {item.alternativeEvidenceTypes.length > 0 && <span>+{item.alternativeEvidenceTypes.length} alternatives</span>}
                <span>{item.answerSuggestionCount} answers</span>
                <span>{item.dateCount} dates</span>
                <span>{item.identifierCount} identifiers</span>
                <span>{item.connectionSuggestionCount} connections</span>
                {item.hasContradiction && <Badge tone="warning">contradiction</Badge>}
                {item.hasUnresolvedQuestion && <Badge tone="warning">unresolved question</Badge>}
                {item.failedExtraction && <Badge tone="neutral">no content extracted</Badge>}
                {item.stale && <Badge tone="neutral">stale</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
