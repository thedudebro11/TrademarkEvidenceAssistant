import type { ConnectionCandidate, ConnectionType, SuggestionConfidence } from "@trademark-evidence-assistant/shared";
import type { DraftConnectionView } from "./reviewDraft.js";

/**
 * Pure, item-level browsing state for the Connections Workspace drawer —
 * owned by ReviewQueue.tsx (same pattern as ReviewDraftState in
 * reviewDraft.ts), not by the drawer component itself. The drawer fully
 * unmounts when closed (it renders as an overlay, not inside the
 * Accordion's always-open content), so anything the user would expect to
 * survive a close/reopen — search text, filters, sort, which candidates
 * are staged to link and their relationship details, and scroll position
 * — has to live one level up. See
 * docs/ADR_0003_CONNECTIONS_WORKSPACE_SCROLL_FIX.md for why this file
 * exists instead of local `useState` inside the drawer.
 *
 * No network calls happen here. Candidate fetching stays inside the
 * drawer component (read-only reference data, same reasoning
 * ConnectionsPanel used before this redesign).
 */

export interface SelectedCandidate {
  /** Candidate id, or `manual-<path>` for a typed-path fallback entry. */
  key: string;
  targetPath: string;
  displayName: string;
  type: ConnectionType;
  explanation: string;
  confidence: SuggestionConfidence | "";
}

export type ConnectionWorkspaceSortField = "filename" | "folder" | "evidenceType" | "reviewStatus";

export interface ConnectionWorkspaceFilters {
  /** "" = all folders. */
  folder: string;
  /** "" = all types, "unclassified" = only items with no confirmed evidence type. */
  evidenceTypeId: string;
  /** "" = all statuses. */
  reviewStatus: string;
  /** "" = all decisions, "none" = no decision recorded yet. */
  decisionStatus: string;
}

export interface ConnectionWorkspaceState {
  searchText: string;
  filters: ConnectionWorkspaceFilters;
  sortField: ConnectionWorkspaceSortField;
  /** Captured on drawer unmount, restored on mount — see ConnectionsWorkspace.tsx. */
  scrollTop: number;
  selected: SelectedCandidate[];
  /** Candidate id currently shown in the larger preview overlay, or null. */
  previewCandidateId: string | null;
}

const EMPTY_FILTERS: ConnectionWorkspaceFilters = {
  folder: "",
  evidenceTypeId: "",
  reviewStatus: "",
  decisionStatus: "",
};

export function createConnectionWorkspaceState(): ConnectionWorkspaceState {
  return {
    searchText: "",
    filters: { ...EMPTY_FILTERS },
    sortField: "filename",
    scrollTop: 0,
    selected: [],
    previewCandidateId: null,
  };
}

export function setSearchText(state: ConnectionWorkspaceState, searchText: string): ConnectionWorkspaceState {
  return { ...state, searchText };
}

export function setFilter(
  state: ConnectionWorkspaceState,
  key: keyof ConnectionWorkspaceFilters,
  value: string,
): ConnectionWorkspaceState {
  return { ...state, filters: { ...state.filters, [key]: value } };
}

export function clearFilters(state: ConnectionWorkspaceState): ConnectionWorkspaceState {
  return { ...state, filters: { ...EMPTY_FILTERS } };
}

export function setSort(state: ConnectionWorkspaceState, sortField: ConnectionWorkspaceSortField): ConnectionWorkspaceState {
  return { ...state, sortField };
}

export function setScrollTop(state: ConnectionWorkspaceState, scrollTop: number): ConnectionWorkspaceState {
  return { ...state, scrollTop };
}

export function setPreviewCandidateId(state: ConnectionWorkspaceState, candidateId: string | null): ConnectionWorkspaceState {
  return { ...state, previewCandidateId: candidateId };
}

/** Adds a candidate to the selected set, or removes it if already selected — a plain toggle, never a second copy. */
export function toggleSelectedCandidate(state: ConnectionWorkspaceState, candidate: ConnectionCandidate): ConnectionWorkspaceState {
  const exists = state.selected.some((s) => s.key === candidate.id);
  if (exists) {
    return { ...state, selected: state.selected.filter((s) => s.key !== candidate.id) };
  }
  const entry: SelectedCandidate = {
    key: candidate.id,
    targetPath: candidate.originalPath,
    displayName: candidate.originalFilename,
    type: "related_to",
    explanation: "",
    confidence: "",
  };
  return { ...state, selected: [...state.selected, entry] };
}

/** Manual "add by typed path" fallback — same shape as a picked candidate, keyed distinctly so it can never collide with a real candidate id. */
export function addManualSelected(state: ConnectionWorkspaceState, path: string): ConnectionWorkspaceState {
  const key = `manual-${path}`;
  if (state.selected.some((s) => s.key === key)) return state;
  const entry: SelectedCandidate = { key, targetPath: path, displayName: path, type: "related_to", explanation: "", confidence: "" };
  return { ...state, selected: [...state.selected, entry] };
}

export function updateSelectedCandidate(
  state: ConnectionWorkspaceState,
  key: string,
  patch: Partial<Pick<SelectedCandidate, "type" | "explanation" | "confidence">>,
): ConnectionWorkspaceState {
  return { ...state, selected: state.selected.map((s) => (s.key === key ? { ...s, ...patch } : s)) };
}

export function removeSelectedCandidate(state: ConnectionWorkspaceState, key: string): ConnectionWorkspaceState {
  return { ...state, selected: state.selected.filter((s) => s.key !== key) };
}

/** Used after a successful "Link" submit — the queue empties, everything else (search/filters/sort/scroll) is left exactly as the user had it. */
export function clearSelected(state: ConnectionWorkspaceState): ConnectionWorkspaceState {
  return { ...state, selected: [] };
}

export function folderOf(originalPath: string): string {
  const idx = originalPath.lastIndexOf("/");
  return idx === -1 ? "" : originalPath.slice(0, idx);
}

export type CandidateConnectionStatus = "linked" | "pending" | "removal" | "none";

/** How a candidate currently relates to the item being reviewed, per the in-progress Review Draft — never a live server lookup, so it can never disagree with what the Connect list already shows. */
export function candidateConnectionStatus(
  candidate: ConnectionCandidate,
  connections: DraftConnectionView[],
): CandidateConnectionStatus {
  const match = connections.find((c) => c.relatedOriginalPath === candidate.originalPath);
  if (!match) return "none";
  if (match.markedForRemoval) return "removal";
  if (match.connectionId === null) return "pending";
  return "linked";
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Applies search + filters + sort, in that order, to the full candidate
 * list. Deliberately does NOT remove already-connected candidates —
 * unlike the old horizontal picker, the workspace shows every evidence
 * item so its connection status (linked/pending/removal) is always
 * visible, and never resorts based on selection — selecting a card must
 * never reorder the grid out from under the user.
 */
export function filterAndSortCandidates(
  candidates: ConnectionCandidate[],
  state: ConnectionWorkspaceState,
): ConnectionCandidate[] {
  const query = state.searchText.trim().toLowerCase();
  const { folder, evidenceTypeId, reviewStatus, decisionStatus } = state.filters;

  const filtered = candidates.filter((c) => {
    if (query && !c.originalFilename.toLowerCase().includes(query) && !c.originalPath.toLowerCase().includes(query)) {
      return false;
    }
    if (folder && folderOf(c.originalPath) !== folder) return false;
    if (evidenceTypeId === "unclassified" && c.evidenceTypeId !== null) return false;
    if (evidenceTypeId && evidenceTypeId !== "unclassified" && c.evidenceTypeId !== evidenceTypeId) return false;
    if (reviewStatus && c.reviewStatus !== reviewStatus) return false;
    if (decisionStatus === "none" && c.inclusionDecision !== null) return false;
    if (decisionStatus && decisionStatus !== "none" && c.inclusionDecision !== decisionStatus) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (state.sortField) {
      case "filename":
        return compareStrings(a.originalFilename, b.originalFilename) || compareStrings(a.originalPath, b.originalPath);
      case "folder":
        return compareStrings(folderOf(a.originalPath), folderOf(b.originalPath)) || compareStrings(a.originalFilename, b.originalFilename);
      case "evidenceType":
        return (
          compareStrings(a.evidenceTypeId ?? "", b.evidenceTypeId ?? "") || compareStrings(a.originalFilename, b.originalFilename)
        );
      case "reviewStatus":
        return compareStrings(a.reviewStatus, b.reviewStatus) || compareStrings(a.originalFilename, b.originalFilename);
    }
  });

  return sorted;
}
