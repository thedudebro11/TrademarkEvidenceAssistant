import { useEffect, useMemo, useState } from "react";
import type { SuggestionConfidence, SuggestionQueueFilters, SuggestionQueueItemView } from "@trademark-evidence-assistant/shared";
import { getPreviewKind } from "@trademark-evidence-assistant/shared";
import { evidenceItemFileUrl, fetchSuggestionsQueue, heicPreviewFileUrl } from "../../api.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
import { StatusMessage } from "../ui/StatusMessage.js";
import { setPendingReviewItemId, useRouter } from "../../app/router.js";

/**
 * Evidence Intelligence Phase 2 — the Review Suggestions workspace: a
 * full-size, practical way to work through dozens or hundreds of staged
 * results, not a compressed sidebar list. Every item shown here still
 * has unconfirmed, staged suggestions; opening one navigates to the
 * existing Review page and reuses the existing Phase 1 AnalysisPanel —
 * this component never itself confirms anything, creates a connection,
 * changes review status/inclusion, or edits notes. It does not offer
 * mass confirmation.
 */

type GroupBy = "none" | "folder" | "evidenceType" | "confidence" | "status";
type SortBy = "filename" | "folder" | "confidence" | "contradictions" | "unresolved" | "connections" | "newest";

interface ReviewSuggestionsQueueProps {
  /** Scope to one batch job's items, or omit for every item with pending suggestions workspace-wide. */
  jobId?: number;
  onClose?: () => void;
}

const CONFIDENCE_OPTIONS: SuggestionConfidence[] = ["low", "medium", "high"];
const CONFIDENCE_RANK: Record<SuggestionConfidence, number> = { low: 0, medium: 1, high: 2 };

function itemStatusLabel(item: SuggestionQueueItemView): string {
  if (item.stale) return "Stale";
  if (item.hasContradiction || item.hasUnresolvedQuestion) return "Needs attention";
  return "Ready to review";
}

function groupKey(item: SuggestionQueueItemView, groupBy: GroupBy): string {
  switch (groupBy) {
    case "folder":
      return item.folder || "(root)";
    case "evidenceType":
      return item.suggestedEvidenceType ?? "(no suggestion)";
    case "confidence":
      return item.confidence ?? "(none)";
    case "status":
      return itemStatusLabel(item);
    case "none":
    default:
      return "";
  }
}

function sortItems(items: SuggestionQueueItemView[], sortBy: SortBy): SuggestionQueueItemView[] {
  const sorted = [...items];
  switch (sortBy) {
    case "filename":
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
      break;
    case "folder":
      sorted.sort((a, b) => a.folder.localeCompare(b.folder) || a.filename.localeCompare(b.filename));
      break;
    case "confidence":
      sorted.sort((a, b) => CONFIDENCE_RANK[b.confidence ?? "low"] - CONFIDENCE_RANK[a.confidence ?? "low"]);
      break;
    case "contradictions":
      sorted.sort((a, b) => Number(b.hasContradiction) - Number(a.hasContradiction));
      break;
    case "unresolved":
      sorted.sort((a, b) => Number(b.hasUnresolvedQuestion) - Number(a.hasUnresolvedQuestion));
      break;
    case "connections":
      sorted.sort((a, b) => b.connectionSuggestionCount - a.connectionSuggestionCount);
      break;
    case "newest":
      sorted.sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
      break;
  }
  return sorted;
}

export function ReviewSuggestionsQueue({ jobId, onClose }: ReviewSuggestionsQueueProps) {
  const { navigate } = useRouter();
  const [filters, setFilters] = useState<Omit<SuggestionQueueFilters, "jobId">>({});
  const [items, setItems] = useState<SuggestionQueueItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortBy, setSortBy] = useState<SortBy>("filename");

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

  const folderOptions = useMemo(() => [...new Set((items ?? []).map((i) => i.folder))].sort(), [items]);
  const typeOptions = useMemo(() => [...new Set((items ?? []).map((i) => i.suggestedEvidenceType).filter((t): t is string => Boolean(t)))].sort(), [items]);

  const grouped = useMemo(() => {
    const sorted = sortItems(items ?? [], sortBy);
    if (groupBy === "none") return [{ label: null as string | null, items: sorted }];
    const groups = new Map<string, SuggestionQueueItemView[]>();
    for (const item of sorted) {
      const key = groupKey(item, groupBy);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return [...groups.entries()].map(([label, groupItems]) => ({ label, items: groupItems }));
  }, [items, groupBy, sortBy]);

  return (
    <section className="suggestion-queue" aria-label="Review Suggestions workspace">
      <div className="suggestion-queue__header">
        <h3 style={{ margin: 0 }}>Review Suggestions{items ? ` (${items.length})` : ""}</h3>
        {onClose && (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      <div className="suggestion-queue__controls">
        <label>
          Folder
          <select aria-label="Filter by folder" value={filters.folder ?? ""} onChange={(e) => setFilters((prev) => ({ ...prev, folder: e.target.value || undefined }))}>
            <option value="">All folders</option>
            {folderOptions.map((f) => (
              <option key={f || "(root)"} value={f}>
                {f || "(root)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Evidence type
          <select aria-label="Filter by evidence type" value={filters.evidenceType ?? ""} onChange={(e) => setFilters((prev) => ({ ...prev, evidenceType: e.target.value || undefined }))}>
            <option value="">All types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minimum confidence
          <select
            aria-label="Minimum confidence"
            value={filters.minConfidence ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, minConfidence: (e.target.value || undefined) as SuggestionConfidence | undefined }))}
          >
            <option value="">Any confidence</option>
            {CONFIDENCE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c} or higher
              </option>
            ))}
          </select>
        </label>
        <label>
          Group by
          <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="none">No grouping</option>
            <option value="folder">Folder</option>
            <option value="evidenceType">Suggested evidence type</option>
            <option value="confidence">Confidence</option>
            <option value="status">Analysis status</option>
          </select>
        </label>
        <label>
          Sort by
          <select aria-label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="filename">Filename</option>
            <option value="folder">Folder</option>
            <option value="confidence">Confidence</option>
            <option value="contradictions">Most contradictions</option>
            <option value="unresolved">Most unresolved questions</option>
            <option value="connections">Most connections</option>
            <option value="newest">Newest analysis</option>
          </select>
        </label>
      </div>

      <div className="suggestion-queue__toggle-filters">
        <label>
          <input type="checkbox" checked={Boolean(filters.unresolvedCustomerStatus)} onChange={() => toggle("unresolvedCustomerStatus")} /> Unresolved questions
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.hasContradiction)} onChange={() => toggle("hasContradiction")} /> Has a contradiction
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.hasConnections)} onChange={() => toggle("hasConnections")} /> Has connection suggestions
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.failedExtraction)} onChange={() => toggle("failedExtraction")} /> No useful content extracted
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.stale)} onChange={() => toggle("stale")} /> Stale — needs reanalysis
        </label>
        <label>
          <input type="checkbox" checked={Boolean(filters.noProvider)} onChange={() => toggle("noProvider")} /> Deterministic analysis only
        </label>
      </div>

      {error && <StatusMessage tone="error">Could not load the suggestions queue. {error}</StatusMessage>}

      {items && items.length === 0 && <p role="status">No items match these filters.</p>}

      {items &&
        items.length > 0 &&
        grouped.map((group) => (
          <div key={group.label ?? "__all__"} className="suggestion-queue__group">
            {group.label !== null && (
              <h4 className="suggestion-queue__group-label">
                {group.label} <span className="suggestion-queue__group-count">({group.items.length})</span>
              </h4>
            )}
            <ul className="suggestion-queue__list">
              {group.items.map((item) => (
                <QueueRow key={item.evidenceItemId} item={item} onOpen={() => openItem(item)} />
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function Thumbnail({ item }: { item: SuggestionQueueItemView }) {
  const kind = getPreviewKind(item.extension);
  const [failed, setFailed] = useState(false);
  if (!failed && kind === "image") {
    return <img className="suggestion-queue__thumb-img" src={evidenceItemFileUrl(item.evidenceItemId)} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  if (!failed && kind === "heic") {
    return <img className="suggestion-queue__thumb-img" src={heicPreviewFileUrl(item.evidenceItemId)} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <div className="suggestion-queue__thumb-fallback" aria-hidden="true">
      {item.extension.toUpperCase() || "FILE"}
    </div>
  );
}

function QueueRow({ item, onOpen }: { item: SuggestionQueueItemView; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="suggestion-queue__row" onClick={onOpen} title={`${item.folder ? item.folder + "/" : ""}${item.filename}`}>
        <div className="suggestion-queue__thumb">
          <Thumbnail item={item} />
        </div>
        <div className="suggestion-queue__main">
          <div className="suggestion-queue__filename">{item.filename}</div>
          <div className="suggestion-queue__folder">{item.folder || "(root)"}</div>
        </div>
        <div className="suggestion-queue__badges">
          {item.suggestedEvidenceType ? <Badge tone="info">{item.suggestedEvidenceType.replace(/_/g, " ")}</Badge> : <Badge tone="neutral">no suggestion</Badge>}
          {item.confidence && <Badge tone="neutral">{item.confidence} confidence</Badge>}
          {item.alternativeEvidenceTypes.length > 0 && <Badge tone="neutral">+{item.alternativeEvidenceTypes.length} alternative{item.alternativeEvidenceTypes.length === 1 ? "" : "s"}</Badge>}
          <span className="suggestion-queue__stat">{item.answerSuggestionCount} answer{item.answerSuggestionCount === 1 ? "" : "s"}</span>
          <span className="suggestion-queue__stat">{item.dateCount} date{item.dateCount === 1 ? "" : "s"}</span>
          <span className="suggestion-queue__stat">{item.identifierCount} identifier{item.identifierCount === 1 ? "" : "s"}</span>
          <span className="suggestion-queue__stat">{item.connectionSuggestionCount} connection{item.connectionSuggestionCount === 1 ? "" : "s"}</span>
          {item.hasContradiction && <Badge tone="warning">contradiction</Badge>}
          {item.hasUnresolvedQuestion && <Badge tone="warning">unresolved question</Badge>}
          {item.failedExtraction && <Badge tone="neutral">no content extracted</Badge>}
          {item.stale && <Badge tone="warning">stale</Badge>}
          <Badge tone="neutral">{item.providerAvailable ? "AI-assisted" : "Deterministic analysis only"}</Badge>
        </div>
      </button>
    </li>
  );
}
