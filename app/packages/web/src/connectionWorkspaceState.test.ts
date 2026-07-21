import { describe, expect, it } from "vitest";
import type { ConnectionCandidate } from "@trademark-evidence-assistant/shared";
import type { DraftConnectionView } from "./reviewDraft.js";
import {
  addManualSelected,
  candidateConnectionStatus,
  clearFilters,
  clearSelected,
  createConnectionWorkspaceState,
  filterAndSortCandidates,
  folderOf,
  removeSelectedCandidate,
  setFilter,
  setScrollTop,
  setSearchText,
  setSort,
  toggleSelectedCandidate,
  updateSelectedCandidate,
} from "./connectionWorkspaceState.js";

const candidates: ConnectionCandidate[] = [
  { id: "item-2", originalPath: "Proof Files/invoice_44821.pdf", originalFilename: "invoice_44821.pdf", reviewStatus: "reviewed", inclusionDecision: "include", evidenceTypeId: "printful_invoice" },
  { id: "item-3", originalPath: "Design Files/final_logo.jpg", originalFilename: "final_logo.jpg", reviewStatus: "excluded", inclusionDecision: "not_useful", evidenceTypeId: "final_logo" },
  { id: "item-4", originalPath: "Design Files/mockup.psd", originalFilename: "mockup.psd", reviewStatus: "unreviewed", inclusionDecision: null, evidenceTypeId: null },
];

describe("connectionWorkspaceState — selection", () => {
  it("toggling a candidate adds it, toggling again removes it", () => {
    let state = createConnectionWorkspaceState();
    state = toggleSelectedCandidate(state, candidates[0]);
    expect(state.selected.map((s) => s.key)).toEqual(["item-2"]);
    state = toggleSelectedCandidate(state, candidates[0]);
    expect(state.selected).toEqual([]);
  });

  it("selecting never touches search, filters, sort, or scrollTop", () => {
    let state = createConnectionWorkspaceState();
    state = setSearchText(state, "logo");
    state = setFilter(state, "folder", "Design Files");
    state = setSort(state, "folder");
    state = setScrollTop(state, 420);
    const before = { searchText: state.searchText, filters: state.filters, sortField: state.sortField, scrollTop: state.scrollTop };

    state = toggleSelectedCandidate(state, candidates[1]);
    state = toggleSelectedCandidate(state, candidates[2]);

    expect({ searchText: state.searchText, filters: state.filters, sortField: state.sortField, scrollTop: state.scrollTop }).toEqual(before);
  });

  it("updateSelectedCandidate patches only the matching entry's relationship details", () => {
    let state = createConnectionWorkspaceState();
    state = toggleSelectedCandidate(state, candidates[0]);
    state = toggleSelectedCandidate(state, candidates[1]);
    state = updateSelectedCandidate(state, "item-2", { explanation: "Same order." });

    expect(state.selected.find((s) => s.key === "item-2")?.explanation).toBe("Same order.");
    expect(state.selected.find((s) => s.key === "item-3")?.explanation).toBe("");
  });

  it("removeSelectedCandidate drops one queued entry without affecting others", () => {
    let state = createConnectionWorkspaceState();
    state = toggleSelectedCandidate(state, candidates[0]);
    state = toggleSelectedCandidate(state, candidates[1]);
    state = removeSelectedCandidate(state, "item-2");
    expect(state.selected.map((s) => s.key)).toEqual(["item-3"]);
  });

  it("clearSelected empties the queue but leaves search/filters/sort/scrollTop untouched", () => {
    let state = createConnectionWorkspaceState();
    state = setSearchText(state, "logo");
    state = setScrollTop(state, 300);
    state = toggleSelectedCandidate(state, candidates[0]);
    state = clearSelected(state);
    expect(state.selected).toEqual([]);
    expect(state.searchText).toBe("logo");
    expect(state.scrollTop).toBe(300);
  });

  it("addManualSelected queues a typed path once, not twice", () => {
    let state = createConnectionWorkspaceState();
    state = addManualSelected(state, "Some Folder/unreviewed.pdf");
    state = addManualSelected(state, "Some Folder/unreviewed.pdf");
    expect(state.selected).toHaveLength(1);
    expect(state.selected[0].key).toBe("manual-Some Folder/unreviewed.pdf");
  });
});

describe("connectionWorkspaceState — filters and sort", () => {
  it("filters by folder, evidence type, review status, and decision status", () => {
    const state = setFilter(createConnectionWorkspaceState(), "folder", "Design Files");
    const result = filterAndSortCandidates(candidates, state);
    expect(result.map((c) => c.id)).toEqual(["item-3", "item-4"]);
  });

  it("the 'unclassified' sentinel matches only candidates with no confirmed evidence type", () => {
    const state = setFilter(createConnectionWorkspaceState(), "evidenceTypeId", "unclassified");
    const result = filterAndSortCandidates(candidates, state);
    expect(result.map((c) => c.id)).toEqual(["item-4"]);
  });

  it("the 'none' decision-status sentinel matches only candidates with no recorded decision", () => {
    const state = setFilter(createConnectionWorkspaceState(), "decisionStatus", "none");
    const result = filterAndSortCandidates(candidates, state);
    expect(result.map((c) => c.id)).toEqual(["item-4"]);
  });

  it("clearFilters resets every filter back to 'all'", () => {
    let state = setFilter(createConnectionWorkspaceState(), "folder", "Design Files");
    state = setFilter(state, "reviewStatus", "excluded");
    state = clearFilters(state);
    expect(filterAndSortCandidates(candidates, state)).toHaveLength(3);
  });

  it("sorts by filename, folder, evidence type, and review status, each with a stable filename tiebreak", () => {
    const byFilename = filterAndSortCandidates(candidates, setSort(createConnectionWorkspaceState(), "filename"));
    expect(byFilename.map((c) => c.originalFilename)).toEqual(["final_logo.jpg", "invoice_44821.pdf", "mockup.psd"]);

    const byFolder = filterAndSortCandidates(candidates, setSort(createConnectionWorkspaceState(), "folder"));
    expect(byFolder.map((c) => c.id)).toEqual(["item-3", "item-4", "item-2"]);

    const byStatus = filterAndSortCandidates(candidates, setSort(createConnectionWorkspaceState(), "reviewStatus"));
    expect(byStatus.map((c) => c.reviewStatus)).toEqual(["excluded", "reviewed", "unreviewed"]);
  });

  it("sorting never depends on selection state — selecting an item cannot move it in the list", () => {
    const state = setSort(createConnectionWorkspaceState(), "filename");
    const before = filterAndSortCandidates(candidates, state).map((c) => c.id);
    const afterSelect = filterAndSortCandidates(candidates, toggleSelectedCandidate(state, candidates[2])).map((c) => c.id);
    expect(afterSelect).toEqual(before);
  });

  it("search matches filename or full path, case-insensitively", () => {
    const state = setSearchText(createConnectionWorkspaceState(), "PROOF");
    expect(filterAndSortCandidates(candidates, state).map((c) => c.id)).toEqual(["item-2"]);
  });

  it("connected candidates are not removed from the list — the workspace shows every item, badged by status", () => {
    const state = createConnectionWorkspaceState();
    expect(filterAndSortCandidates(candidates, state)).toHaveLength(3);
  });
});

describe("connectionWorkspaceState — candidateConnectionStatus", () => {
  const linked: DraftConnectionView = {
    draftKey: "conn-7",
    connectionId: 7,
    direction: "outgoing",
    relatedOriginalPath: "Proof Files/invoice_44821.pdf",
    type: "related_to",
    explanation: "Same order.",
    confidence: "medium",
    markedForRemoval: false,
  };

  it("returns 'none' when no connection matches the candidate's path", () => {
    expect(candidateConnectionStatus(candidates[1], [linked])).toBe("none");
  });

  it("returns 'linked' for a persisted connection", () => {
    expect(candidateConnectionStatus(candidates[0], [linked])).toBe("linked");
  });

  it("returns 'pending' for a not-yet-saved addition", () => {
    const pending = { ...linked, connectionId: null, direction: "new" as const };
    expect(candidateConnectionStatus(candidates[0], [pending])).toBe("pending");
  });

  it("returns 'removal' for a connection marked for removal, even though it's still technically linked until saved", () => {
    const removal = { ...linked, markedForRemoval: true };
    expect(candidateConnectionStatus(candidates[0], [removal])).toBe("removal");
  });
});

describe("connectionWorkspaceState — folderOf", () => {
  it("returns the path minus the filename, or '' for a root-level file", () => {
    expect(folderOf("Design Files/final_logo.jpg")).toBe("Design Files");
    expect(folderOf("final_logo.jpg")).toBe("");
    expect(folderOf("A/B/C/final_logo.jpg")).toBe("A/B/C");
  });
});
