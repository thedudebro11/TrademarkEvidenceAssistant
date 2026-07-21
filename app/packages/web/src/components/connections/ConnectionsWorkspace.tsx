import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONNECTION_TYPES,
  SUGGESTION_CONFIDENCES,
  getEvidenceType,
  getPreviewKind,
  type ConnectionCandidate,
  type ConnectionType,
  type DraftConnectionAdd,
  type EvidenceItemDetail,
  type SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import type { DraftConnectionView } from "../../reviewDraft.js";
import {
  candidateConnectionStatus,
  filterAndSortCandidates,
  folderOf,
  type ConnectionWorkspaceFilters,
  type ConnectionWorkspaceSortField,
  type ConnectionWorkspaceState,
  type SelectedCandidate,
} from "../../connectionWorkspaceState.js";
import { evidenceItemFileUrl, fetchConnectionCandidates, fetchItem } from "../../api.js";
import { decisionStatus } from "../../DecisionBar.js";
import { EvidenceViewer } from "../evidence-viewer/EvidenceViewer.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import { CloseIcon, ExpandIcon } from "../ui/icons.js";

interface ConnectionsWorkspaceProps {
  open: boolean;
  /** Extension and evidenceTypeId are already on the item ReviewQueue holds — no extra fetch needed to show the "Currently reviewing" thumbnail. */
  currentItem: { id: string; originalFilename: string; extension: string; evidenceTypeId: string | null };
  connections: DraftConnectionView[];
  state: ConnectionWorkspaceState;
  onSearchChange: (text: string) => void;
  onFilterChange: (key: keyof ConnectionWorkspaceFilters, value: string) => void;
  onClearFilters: () => void;
  onSortChange: (field: ConnectionWorkspaceSortField) => void;
  onToggleCandidate: (candidate: ConnectionCandidate) => void;
  onAddManual: (path: string) => void;
  onUpdateSelected: (key: string, patch: Partial<Pick<SelectedCandidate, "type" | "explanation" | "confidence">>) => void;
  onRemoveSelected: (key: string) => void;
  onScrollTopChange: (value: number) => void;
  onPreviewCandidate: (candidateId: string | null) => void;
  onLinkAll: (adds: DraftConnectionAdd[]) => void;
  onClose: () => void;
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1);
}

function evidenceTypeLabelOf(typeId: string | null): string {
  if (!typeId) return "Unclassified";
  return getEvidenceType(typeId)?.displayName ?? typeId;
}

const SORT_OPTIONS: { field: ConnectionWorkspaceSortField; label: string }[] = [
  { field: "filename", label: "Filename" },
  { field: "folder", label: "Folder" },
  { field: "evidenceType", label: "Evidence type" },
  { field: "reviewStatus", label: "Review status" },
];

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  linked: "Linked",
  pending: "Pending link",
  removal: "Pending removal",
};

/** Small/Medium/Large/Huge map to the grid's minimum card width — see the `--connections-card-min` custom property consumed by `.connections-workspace__grid` in review.css. Large (340px) is the default per the visual-recognition redesign: artwork should dominate, never a maximum-density file list. */
const THUMBNAIL_SIZES = ["small", "medium", "large", "huge"] as const;
type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];
const THUMBNAIL_SIZE_PX: Record<ThumbnailSize, number> = { small: 220, medium: 280, large: 340, huge: 420 };
const THUMBNAIL_SIZE_LABEL: Record<ThumbnailSize, string> = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };
const THUMBNAIL_SIZE_STORAGE_KEY = "connections-workspace:thumbnail-size";

function loadThumbnailSize(): ThumbnailSize {
  try {
    const stored = window.localStorage.getItem(THUMBNAIL_SIZE_STORAGE_KEY);
    if (stored && (THUMBNAIL_SIZES as readonly string[]).includes(stored)) return stored as ThumbnailSize;
  } catch {
    // localStorage unavailable (e.g. privacy mode) — fall back to the default silently.
  }
  return "large";
}

/**
 * The large candidate browser (docs/ADR_0003_CONNECTIONS_WORKSPACE_SCROLL_FIX.md).
 * All browsing state (search/filters/sort/selection/scroll/preview) is
 * owned by ReviewQueue via connectionWorkspaceState.ts and passed in —
 * this component is deliberately a thin, controlled view over it, so
 * closing/reopening this drawer (which fully unmounts it — it renders
 * outside the Accordion, not inside the always-collapsible "Connect"
 * section) never loses anything the user already set up.
 *
 * The candidate grid is never conditionally unmounted while this
 * component itself stays mounted — selecting, deselecting, editing a
 * queued relationship, adding another candidate, opening/closing the
 * inline preview, changing thumbnail size, and redraws triggered by
 * draft updates all leave the grid's DOM node in place, so the
 * browser's native scroll position survives those interactions with no
 * code needed at all. Scroll position is only explicitly saved/restored
 * across this component's own mount/unmount (drawer close/reopen),
 * which is a real, unavoidable unmount — not a bug being papered over.
 *
 * Thumbnail size is a cross-item, cross-session UI preference (not
 * review data), so it's read/written straight to localStorage here
 * rather than living in the lifted, per-item connectionWorkspaceState.
 */
export function ConnectionsWorkspace({
  open,
  currentItem,
  connections,
  state,
  onSearchChange,
  onFilterChange,
  onClearFilters,
  onSortChange,
  onToggleCandidate,
  onAddManual,
  onUpdateSelected,
  onRemoveSelected,
  onScrollTopChange,
  onPreviewCandidate,
  onLinkAll,
  onClose,
}: ConnectionsWorkspaceProps) {
  const [candidates, setCandidates] = useState<ConnectionCandidate[]>([]);
  const [previewItem, setPreviewItem] = useState<EvidenceItemDetail | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [thumbnailSize, setThumbnailSize] = useState<ThumbnailSize>(loadThumbnailSize);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(state.scrollTop);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchConnectionCandidates(currentItem.id)
      .then((items) => {
        if (!cancelled) setCandidates(items);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentItem.id]);

  // Restore scroll position whenever the drawer transitions to open.
  // This component's hooks never truly unmount — it's always present in
  // the JSX tree; `open` only decides whether it renders anything below
  // — but returning null DOES tear down and recreate its DOM subtree
  // each time, including the grid's scrollTop (which resets to 0 on the
  // new node). Keying this off `[]` (mount-only) meant it silently
  // never re-ran on a real close/reopen. Keying off `[open]` instead
  // fires every time the drawer actually becomes visible again, and
  // never on subsequent renders while it stays open, so nothing here
  // can reset scroll mid-session.
  useEffect(() => {
    if (!open) return;
    if (gridRef.current) gridRef.current.scrollTop = state.scrollTop;
    searchInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Commit the latest scroll offset to lifted state whenever the drawer
  // closes — not an unmount cleanup (see above: this component's hooks
  // never actually unmount when `open` becomes false).
  useEffect(() => {
    if (!open) onScrollTopChange(scrollTopRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (state.previewCandidateId) {
          onPreviewCandidate(null);
        } else {
          onClose();
        }
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, state.previewCandidateId, onClose, onPreviewCandidate]);

  useEffect(() => {
    if (!state.previewCandidateId) {
      setPreviewItem(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    fetchItem(state.previewCandidateId)
      .then((item) => {
        if (!cancelled) setPreviewItem(item);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state.previewCandidateId]);

  function changeThumbnailSize(size: ThumbnailSize) {
    setThumbnailSize(size);
    try {
      window.localStorage.setItem(THUMBNAIL_SIZE_STORAGE_KEY, size);
    } catch {
      // Best-effort persistence only — a failed write just means the
      // preference resets next session, not a functional problem now.
    }
  }

  const visibleCandidates = useMemo(() => filterAndSortCandidates(candidates, state), [candidates, state]);

  const folders = useMemo(() => [...new Set(candidates.map((c) => folderOf(c.originalPath)))].sort(), [candidates]);
  const evidenceTypeIds = useMemo(() => [...new Set(candidates.map((c) => c.evidenceTypeId).filter((id): id is string => id !== null))].sort(), [candidates]);
  const reviewStatuses = useMemo(() => [...new Set(candidates.map((c) => c.reviewStatus))].sort(), [candidates]);

  const query = state.searchText.trim().toLowerCase();
  const exactCandidateMatch = candidates.some((c) => c.originalPath.toLowerCase() === query || c.originalFilename.toLowerCase() === query);
  const alreadySelected = state.selected.some((s) => s.targetPath.toLowerCase() === query);
  const canSubmit = state.selected.length > 0 && state.selected.every((s) => s.explanation.trim().length > 0);

  if (!open) return null;

  function handleLinkAll() {
    onLinkAll(
      state.selected.map((s) => ({
        targetPath: s.targetPath,
        type: s.type,
        explanation: s.explanation.trim(),
        confidence: s.confidence || null,
      })),
    );
  }

  const currentItemIsImage = getPreviewKind(currentItem.extension) === "image";

  return (
    <div className="connections-workspace">
      <div className="connections-workspace__backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        className="connections-workspace__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Link evidence to ${currentItem.originalFilename}`}
      >
        <header className="connections-workspace__header">
          <strong>Link Related Evidence</strong>
          <IconButton aria-label="Close" icon={<CloseIcon size={20} />} onClick={onClose} />
        </header>

        <div className="connections-workspace__current">
          <div className="connections-workspace__current-thumb">
            {currentItemIsImage ? (
              <img src={evidenceItemFileUrl(currentItem.id)} alt="" />
            ) : (
              <span className="connections-workspace__card-fallback">{extensionOf(currentItem.originalFilename).toUpperCase() || "FILE"}</span>
            )}
          </div>
          <div className="connections-workspace__current-info">
            <span className="connections-workspace__current-label">Currently reviewing</span>
            <strong className="connections-workspace__current-filename">{currentItem.originalFilename}</strong>
            <Badge tone="neutral">{evidenceTypeLabelOf(currentItem.evidenceTypeId)}</Badge>
          </div>
        </div>

        <div className="connections-workspace__toolbar">
          <label htmlFor="connections-workspace-search">Search evidence</label>
          <input
            id="connections-workspace-search"
            ref={searchInputRef}
            value={state.searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by filename, path, or type a path"
            autoComplete="off"
          />
          {query && !exactCandidateMatch && !alreadySelected && (
            <button type="button" onClick={() => onAddManual(state.searchText.trim())}>
              Add "{state.searchText.trim()}" by path
            </button>
          )}

          <label htmlFor="connections-workspace-folder">Folder</label>
          <select id="connections-workspace-folder" value={state.filters.folder} onChange={(e) => onFilterChange("folder", e.target.value)}>
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f || "__root__"} value={f}>
                {f || "(root)"}
              </option>
            ))}
          </select>

          <label htmlFor="connections-workspace-type">Evidence type</label>
          <select id="connections-workspace-type" value={state.filters.evidenceTypeId} onChange={(e) => onFilterChange("evidenceTypeId", e.target.value)}>
            <option value="">All types</option>
            <option value="unclassified">Unclassified</option>
            {evidenceTypeIds.map((id) => (
              <option key={id} value={id}>
                {getEvidenceType(id)?.displayName ?? id}
              </option>
            ))}
          </select>

          <label htmlFor="connections-workspace-review-status">Review status</label>
          <select id="connections-workspace-review-status" value={state.filters.reviewStatus} onChange={(e) => onFilterChange("reviewStatus", e.target.value)}>
            <option value="">All statuses</option>
            {reviewStatuses.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <label htmlFor="connections-workspace-decision">Decision</label>
          <select id="connections-workspace-decision" value={state.filters.decisionStatus} onChange={(e) => onFilterChange("decisionStatus", e.target.value)}>
            <option value="">All decisions</option>
            <option value="none">No decision yet</option>
            <option value="include">Include</option>
            <option value="maybe">Maybe</option>
            <option value="not_useful">Not useful</option>
          </select>

          <label htmlFor="connections-workspace-sort">Sort by</label>
          <select id="connections-workspace-sort" value={state.sortField} onChange={(e) => onSortChange(e.target.value as ConnectionWorkspaceSortField)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.field} value={o.field}>
                {o.label}
              </option>
            ))}
          </select>

          <button type="button" onClick={onClearFilters}>
            Clear filters
          </button>

          <div className="connections-workspace__size-control" role="radiogroup" aria-label="Thumbnail size">
            {THUMBNAIL_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={thumbnailSize === size}
                className={thumbnailSize === size ? "connections-workspace__size-option connections-workspace__size-option--active" : "connections-workspace__size-option"}
                onClick={() => changeThumbnailSize(size)}
              >
                {THUMBNAIL_SIZE_LABEL[size]}
              </button>
            ))}
          </div>
        </div>

        <div className="connections-workspace__body">
          <div
            ref={gridRef}
            className="connections-workspace__grid"
            role="listbox"
            aria-multiselectable="true"
            aria-label="Evidence candidates"
            style={{ "--connections-card-min": `${THUMBNAIL_SIZE_PX[thumbnailSize]}px` } as React.CSSProperties}
            onScroll={(e) => {
              scrollTopRef.current = e.currentTarget.scrollTop;
            }}
          >
            {visibleCandidates.length === 0 && <p className="connections-workspace__empty">No evidence matches the current search and filters.</p>}
            {visibleCandidates.map((c) => {
              const status = candidateConnectionStatus(c, connections);
              const isSelectable = status === "none";
              const isSelected = state.selected.some((s) => s.key === c.id);
              const decision = decisionStatus(c.reviewStatus, c.inclusionDecision);
              const isImage = getPreviewKind(extensionOf(c.originalFilename)) === "image";

              function toggle() {
                if (isSelectable) onToggleCandidate(c);
              }

              return (
                <div
                  key={c.id}
                  className={[
                    "connections-workspace__card",
                    isSelected ? "connections-workspace__card--selected" : "",
                    !isSelectable ? "connections-workspace__card--linked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={!isSelectable}
                  tabIndex={isSelectable ? 0 : -1}
                  title={c.originalPath}
                  onClick={toggle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle();
                    }
                  }}
                >
                  <span className="connections-workspace__card-thumb">
                    {isImage ? (
                      <img src={evidenceItemFileUrl(c.id)} alt="" loading="lazy" />
                    ) : (
                      <span className="connections-workspace__card-fallback">{extensionOf(c.originalFilename).toUpperCase() || "FILE"}</span>
                    )}
                    {isSelected && <span className="connections-workspace__card-check">✓</span>}
                    <IconButton
                      className="connections-workspace__card-preview"
                      aria-label={`Preview ${c.originalFilename}`}
                      icon={<ExpandIcon size={16} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreviewCandidate(c.id);
                      }}
                    />
                  </span>
                  <div className="connections-workspace__card-meta">
                    <span className="connections-workspace__card-filename">{c.originalFilename}</span>
                    <span className="connections-workspace__card-subline">
                      {folderOf(c.originalPath) || "(root)"} · {evidenceTypeLabelOf(c.evidenceTypeId)}
                    </span>
                    <span className="connections-workspace__card-badges">
                      {decision ? <Badge tone="success">{decision.label}</Badge> : <Badge tone="neutral">Not reviewed</Badge>}
                      {status !== "none" && <Badge tone={status === "removal" ? "warning" : "info"}>{CONNECTION_STATUS_LABEL[status]}</Badge>}
                    </span>
                    {/* Reserved for future AI relationship badges (Possible Match, Same Artwork, Likely Related, Same Order, Same PSD, Confidence). Intentionally empty — no AI is implemented. */}
                    <div className="connections-workspace__card-ai-slot" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="connections-workspace__selected-pane" aria-label="Selected evidence">
            <h3>Selected {state.selected.length > 0 ? `(${state.selected.length})` : ""}</h3>
            {state.selected.length === 0 && <p className="connections-workspace__empty">Select evidence from the grid to link it here.</p>}
            {state.selected.map((s) => (
              <SelectedCandidateRow key={s.key} selected={s} onUpdate={onUpdateSelected} onRemove={onRemoveSelected} />
            ))}
            <Button variant="primary" fullWidth disabled={!canSubmit} onClick={handleLinkAll}>
              {state.selected.length > 1 ? `Link ${state.selected.length} Evidence Files` : "Link Evidence"}
            </Button>
          </aside>
        </div>

        {state.previewCandidateId && (
          <div className="connections-workspace__preview-overlay">
            <div className="connections-workspace__preview-backdrop" onClick={() => onPreviewCandidate(null)} />
            <div className="connections-workspace__preview-panel" role="dialog" aria-modal="true" aria-label="Evidence preview">
              <header>
                <strong>{previewItem?.originalFilename ?? "Loading…"}</strong>
                <IconButton aria-label="Close preview" icon={<CloseIcon size={18} />} onClick={() => onPreviewCandidate(null)} />
              </header>
              {previewError && <p role="alert">Could not load this preview: {previewError}</p>}
              {!previewError && !previewItem && <p role="status">Loading preview…</p>}
              {previewItem && <EvidenceViewer item={previewItem} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SelectedCandidateRowProps {
  selected: SelectedCandidate;
  onUpdate: (key: string, patch: Partial<Pick<SelectedCandidate, "type" | "explanation" | "confidence">>) => void;
  onRemove: (key: string) => void;
}

function SelectedCandidateRow({ selected, onUpdate, onRemove }: SelectedCandidateRowProps) {
  return (
    <div className="connections-workspace__selected-row">
      <strong>{selected.displayName}</strong>

      <label htmlFor={`workspace-connection-type-${selected.key}`}>Relationship type</label>
      <select
        id={`workspace-connection-type-${selected.key}`}
        value={selected.type}
        onChange={(e) => onUpdate(selected.key, { type: e.target.value as ConnectionType })}
      >
        {CONNECTION_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <label htmlFor={`workspace-connection-explanation-${selected.key}`}>Why are these connected?</label>
      <input
        id={`workspace-connection-explanation-${selected.key}`}
        value={selected.explanation}
        onChange={(e) => onUpdate(selected.key, { explanation: e.target.value })}
        required
      />

      <label htmlFor={`workspace-connection-confidence-${selected.key}`}>Confidence</label>
      <select
        id={`workspace-connection-confidence-${selected.key}`}
        value={selected.confidence}
        onChange={(e) => onUpdate(selected.key, { confidence: e.target.value as SuggestionConfidence | "" })}
      >
        <option value="">Not set</option>
        {SUGGESTION_CONFIDENCES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <button type="button" onClick={() => onRemove(selected.key)}>
        Remove
      </button>
    </div>
  );
}
