import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConnectionCandidate, DraftConnectionAdd, EvidenceItemDetail } from "@trademark-evidence-assistant/shared";
import type { DraftConnectionView } from "../../reviewDraft.js";
import {
  addManualSelected,
  clearFilters,
  createConnectionWorkspaceState,
  removeSelectedCandidate,
  setFilter,
  setPreviewCandidateId,
  setScrollTop,
  setSearchText,
  setSort,
  toggleSelectedCandidate,
  updateSelectedCandidate,
  type ConnectionWorkspaceState,
} from "../../connectionWorkspaceState.js";
import { ConnectionsWorkspace } from "./ConnectionsWorkspace.js";

const candidates: ConnectionCandidate[] = [
  { id: "item-2", originalPath: "Proof Files/invoice_44821.pdf", originalFilename: "invoice_44821.pdf", reviewStatus: "reviewed", inclusionDecision: "include", evidenceTypeId: "printful_invoice" },
  { id: "item-3", originalPath: "Design Files/final_logo.jpg", originalFilename: "final_logo.jpg", reviewStatus: "excluded", inclusionDecision: "not_useful", evidenceTypeId: "final_logo" },
  { id: "item-4", originalPath: "Design Files/mockup.psd", originalFilename: "mockup.psd", reviewStatus: "unreviewed", inclusionDecision: null, evidenceTypeId: null },
  { id: "item-5", originalPath: "Marketing/instagram_post.jpg", originalFilename: "instagram_post.jpg", reviewStatus: "unreviewed", inclusionDecision: null, evidenceTypeId: null },
];

const previewItem: EvidenceItemDetail = {
  id: "item-3",
  originalPath: "Design Files/final_logo.jpg",
  originalFilename: "final_logo.jpg",
  extension: "jpg",
  mimeType: "image/jpeg",
  fileSize: 900,
  sha256: "def456",
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fsCreatedAt: "2026-01-01T00:00:00.000Z",
  fsModifiedAt: "2026-01-01T00:00:00.000Z",
  missingSince: null,
  reviewStatus: "excluded",
  inclusionDecision: "not_useful",
  notes: null,
  notesUpdatedAt: null,
  decidedAt: null,
  metadata: { width: 40, height: 30, pageCount: null },
  duplicates: [],
  fileRole: null,
  answers: [],
  connections: [],
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
  evidenceType: null,
  evidenceTypeSuggestion: null,
  noRelatedEvidence: false,
};

function mockFetch(candidateList: ConnectionCandidate[] = candidates) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/evidence-items/candidates")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => candidateList });
      }
      if (url.includes("/evidence-items/item-3")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => previewItem });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  cleanup();
});

/**
 * Mirrors how ReviewQueue actually owns this component's state — a
 * plain useState holding ConnectionWorkspaceState, with "open" and
 * "connections" independently controllable by the test so behaviors
 * like "close, then reopen" and "existing connections stay linked" can
 * be exercised the same way the real app exercises them.
 */
function Harness({
  initialOpen = true,
  connections = [],
  onLinkAll,
}: {
  initialOpen?: boolean;
  connections?: DraftConnectionView[];
  onLinkAll?: (adds: DraftConnectionAdd[]) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [state, setState] = useState<ConnectionWorkspaceState>(createConnectionWorkspaceState());

  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen workspace</button>
      <ConnectionsWorkspace
        open={open}
        currentItem={{ id: "item-1", originalFilename: "product_photo.jpg", extension: "jpg", evidenceTypeId: "final_logo" }}
        connections={connections}
        state={state}
        onSearchChange={(text) => setState((s) => setSearchText(s, text))}
        onFilterChange={(key, value) => setState((s) => setFilter(s, key, value))}
        onClearFilters={() => setState((s) => clearFilters(s))}
        onSortChange={(field) => setState((s) => setSort(s, field))}
        onToggleCandidate={(c) => setState((s) => toggleSelectedCandidate(s, c))}
        onAddManual={(path) => setState((s) => addManualSelected(s, path))}
        onUpdateSelected={(key, patch) => setState((s) => updateSelectedCandidate(s, key, patch))}
        onRemoveSelected={(key) => setState((s) => removeSelectedCandidate(s, key))}
        onScrollTopChange={(value) => setState((s) => setScrollTop(s, value))}
        onPreviewCandidate={(id) => setState((s) => setPreviewCandidateId(s, id))}
        onLinkAll={(adds) => onLinkAll?.(adds)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

async function renderOpen(props: Parameters<typeof Harness>[0] = {}) {
  mockFetch();
  const utils = render(<Harness {...props} />);
  await waitFor(() => expect(screen.getByText("invoice_44821.pdf")).toBeTruthy());
  return utils;
}

function grid() {
  return screen.getByRole("listbox", { name: "Evidence candidates" });
}

function candidateOption(filename: string) {
  return within(grid()).getByRole("option", { name: new RegExp(filename) });
}

describe("ConnectionsWorkspace — launching the large workspace", () => {
  it("renders nothing when closed", () => {
    mockFetch();
    render(<Harness initialOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opening Connect launches the large workspace as a labeled dialog naming the current item", async () => {
    await renderOpen();
    expect(screen.getByRole("dialog", { name: /product_photo\.jpg/ })).toBeTruthy();
  });

  it("candidates render inside a large vertical grid (listbox), not a horizontal strip", async () => {
    await renderOpen();
    const list = grid();
    expect(list).toBeTruthy();
    expect(within(list).getAllByRole("option")).toHaveLength(candidates.length);
  });
});

describe("ConnectionsWorkspace — scroll position is preserved during in-place interactions", () => {
  it("selecting a candidate preserves scroll position", async () => {
    await renderOpen();
    fireEvent.scroll(grid(), { target: { scrollTop: 240 } });
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    expect(grid().scrollTop).toBe(240);
  });

  it("deselecting a candidate preserves scroll position", async () => {
    await renderOpen();
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    fireEvent.scroll(grid(), { target: { scrollTop: 300 } });
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    expect(grid().scrollTop).toBe(300);
  });

  it("selecting multiple candidates in sequence preserves scroll position throughout", async () => {
    await renderOpen();
    fireEvent.scroll(grid(), { target: { scrollTop: 150 } });
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    expect(grid().scrollTop).toBe(150);
    fireEvent.click(candidateOption("final_logo.jpg"));
    expect(grid().scrollTop).toBe(150);
    fireEvent.click(candidateOption("instagram_post.jpg"));
    expect(grid().scrollTop).toBe(150);
  });

  it("editing a queued candidate's relationship details preserves scroll position", async () => {
    await renderOpen();
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    fireEvent.scroll(grid(), { target: { scrollTop: 80 } });
    fireEvent.change(screen.getByLabelText("Why are these connected?"), { target: { value: "Matches the order." } });
    expect(grid().scrollTop).toBe(80);
  });

  it("adding another candidate to an existing selection preserves scroll position", async () => {
    await renderOpen();
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    fireEvent.scroll(grid(), { target: { scrollTop: 60 } });
    fireEvent.click(candidateOption("final_logo.jpg"));
    expect(grid().scrollTop).toBe(60);
  });
});

describe("ConnectionsWorkspace — candidate preview overlay", () => {
  it("opening a larger preview does not unmount or reset the grid", async () => {
    await renderOpen();
    fireEvent.scroll(grid(), { target: { scrollTop: 220 } });
    fireEvent.click(candidateOption("invoice_44821.pdf"));

    fireEvent.click(screen.getByRole("button", { name: "Preview final_logo.jpg" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Evidence preview" })).toBeTruthy());

    expect(grid().scrollTop).toBe(220);
    expect(candidateOption("invoice_44821.pdf").getAttribute("aria-selected")).toBe("true");
  });

  it("returning from the candidate preview preserves scroll position, selections, filters, search, and queued details exactly", async () => {
    await renderOpen();
    fireEvent.change(screen.getByLabelText("Search evidence"), { target: { value: "logo" } });
    fireEvent.click(candidateOption("final_logo.jpg"));
    fireEvent.change(screen.getByLabelText("Why are these connected?"), { target: { value: "Same brand mark." } });
    fireEvent.scroll(grid(), { target: { scrollTop: 130 } });

    fireEvent.click(screen.getByRole("button", { name: "Preview final_logo.jpg" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Evidence preview" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));

    expect(screen.queryByRole("dialog", { name: "Evidence preview" })).toBeNull();
    expect((screen.getByLabelText("Search evidence") as HTMLInputElement).value).toBe("logo");
    expect(grid().scrollTop).toBe(130);
    expect((screen.getByLabelText("Why are these connected?") as HTMLInputElement).value).toBe("Same brand mark.");
  });
});

describe("ConnectionsWorkspace — closing and reopening preserves browsing state", () => {
  it("search text, a selection, and scroll position all survive a close + reopen", async () => {
    await renderOpen();
    fireEvent.change(screen.getByLabelText("Search evidence"), { target: { value: "final" } });
    fireEvent.click(candidateOption("final_logo.jpg"));
    fireEvent.scroll(grid(), { target: { scrollTop: 175 } });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reopen workspace" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    expect((screen.getByLabelText("Search evidence") as HTMLInputElement).value).toBe("final");
    expect(grid().scrollTop).toBe(175);
    expect(screen.getByText("Selected (1)")).toBeTruthy();
  });
});

describe("ConnectionsWorkspace — search, filters, and sort are unaffected by selection", () => {
  it("search, folder filter, and sort remain unchanged after selecting candidates", async () => {
    await renderOpen();
    fireEvent.change(screen.getByLabelText("Search evidence"), { target: { value: "final" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "Design Files" } });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "folder" } });

    fireEvent.click(candidateOption("final_logo.jpg"));

    expect((screen.getByLabelText("Search evidence") as HTMLInputElement).value).toBe("final");
    expect((screen.getByLabelText("Folder") as HTMLSelectElement).value).toBe("Design Files");
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("folder");
  });

  it("queued selections remain intact even after the search text hides them from the visible grid", async () => {
    await renderOpen();
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    fireEvent.click(candidateOption("final_logo.jpg"));
    expect(screen.getByText("Selected (2)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search evidence"), { target: { value: "mockup" } });
    expect(within(grid()).queryByRole("option", { name: /invoice_44821\.pdf/ })).toBeNull();

    expect(screen.getByText("Selected (2)")).toBeTruthy();
    const selectedPane = screen.getByRole("complementary", { name: "Selected evidence" });
    expect(within(selectedPane).getByText("invoice_44821.pdf")).toBeTruthy();
    expect(within(selectedPane).getByText("final_logo.jpg")).toBeTruthy();
  });
});

describe("ConnectionsWorkspace — linking workflow (existing behavior, preserved)", () => {
  it("Link is disabled until every selected candidate has its own explanation", async () => {
    await renderOpen();
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    expect((screen.getByRole("button", { name: "Link Evidence" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Why are these connected?"), { target: { value: "Matches the order." } });
    expect((screen.getByRole("button", { name: "Link Evidence" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("submitting calls onLinkAll with one entry per selected candidate, each with its own relationship details", async () => {
    const onLinkAll = vi.fn();
    await renderOpen({ onLinkAll });

    fireEvent.click(candidateOption("invoice_44821.pdf"));
    fireEvent.change(screen.getByLabelText("Why are these connected?"), { target: { value: "Matches the order." } });
    fireEvent.click(candidateOption("final_logo.jpg"));
    const explanations = screen.getAllByLabelText("Why are these connected?");
    fireEvent.change(explanations[1], { target: { value: "Same brand mark." } });

    fireEvent.click(screen.getByRole("button", { name: "Link 2 Evidence Files" }));

    expect(onLinkAll).toHaveBeenCalledTimes(1);
    expect(onLinkAll).toHaveBeenCalledWith([
      expect.objectContaining({ targetPath: "Proof Files/invoice_44821.pdf", explanation: "Matches the order." }),
      expect.objectContaining({ targetPath: "Design Files/final_logo.jpg", explanation: "Same brand mark." }),
    ]);
  });

  it("manual 'Add by path' still works as a fallback when nothing in the grid matches", async () => {
    await renderOpen();
    fireEvent.change(screen.getByLabelText("Search evidence"), { target: { value: "Some Folder/unreviewed.pdf" } });
    fireEvent.click(screen.getByRole("button", { name: /Add ".*" by path/ }));

    const selectedPane = screen.getByRole("complementary", { name: "Selected evidence" });
    expect(within(selectedPane).getByText("Some Folder/unreviewed.pdf")).toBeTruthy();
  });

  it("a selected candidate can be removed individually before submitting", async () => {
    await renderOpen();
    fireEvent.click(candidateOption("invoice_44821.pdf"));
    expect(screen.getByText("Selected (1)")).toBeTruthy();

    const selectedPane = screen.getByRole("complementary", { name: "Selected evidence" });
    fireEvent.click(within(selectedPane).getByRole("button", { name: "Remove" }));
    expect(screen.queryByText(/Selected \(\d/)).toBeNull();
  });

  it("existing connections and pending removals are shown as non-selectable cards, badged by status — clicking them does not re-toggle selection", async () => {
    const linked: DraftConnectionView = {
      draftKey: "conn-9",
      connectionId: 9,
      direction: "outgoing",
      relatedOriginalPath: "Proof Files/invoice_44821.pdf",
      type: "related_to",
      explanation: "Linked earlier.",
      confidence: null,
      markedForRemoval: false,
    };
    await renderOpen({ connections: [linked] });

    const card = candidateOption("invoice_44821.pdf");
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(within(card).getByText("Linked")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: /invoice_44821\.pdf/i }));
    expect(card.getAttribute("aria-selected")).toBe("false");
  });
});

describe("ConnectionsWorkspace — 'Currently reviewing' panel", () => {
  it("shows the current item's filename and evidence type at the top of the workspace", async () => {
    await renderOpen();
    expect(screen.getByText("Currently reviewing")).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: /product_photo\.jpg/ });
    expect(within(dialog).getByText("product_photo.jpg", { selector: "strong" })).toBeTruthy();
    // "Final Logo" also appears as an <option> in the Evidence type
    // filter (one of the candidates happens to share the current item's
    // type) — scope to the badge specifically to avoid that ambiguity.
    expect(within(dialog).getByText("Final Logo", { selector: "span.badge" })).toBeTruthy();
  });
});

describe("ConnectionsWorkspace — thumbnail size control", () => {
  it("defaults to Large and persists a new choice to localStorage without losing scroll position", async () => {
    await renderOpen();
    const group = screen.getByRole("radiogroup", { name: "Thumbnail size" });
    expect(within(group).getByRole("radio", { name: "Large" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.scroll(grid(), { target: { scrollTop: 90 } });
    fireEvent.click(within(group).getByRole("radio", { name: "Huge" }));

    expect(within(group).getByRole("radio", { name: "Huge" }).getAttribute("aria-checked")).toBe("true");
    expect(within(group).getByRole("radio", { name: "Large" }).getAttribute("aria-checked")).toBe("false");
    expect(grid().scrollTop).toBe(90);
    expect(window.localStorage.getItem("connections-workspace:thumbnail-size")).toBe("huge");
  });

  it("restores a previously chosen size from localStorage on open", async () => {
    window.localStorage.setItem("connections-workspace:thumbnail-size", "small");
    await renderOpen();
    const group = screen.getByRole("radiogroup", { name: "Thumbnail size" });
    expect(within(group).getByRole("radio", { name: "Small" }).getAttribute("aria-checked")).toBe("true");
  });
});

/**
 * Regression coverage for the "cards render differently depending on
 * folder / result-set size" report. There is no separate skeleton,
 * compact, or virtualized card component or branch anywhere in
 * ConnectionsWorkspace.tsx — every candidate goes through one render
 * path (`isImage ? <img> : <fallback>`), regardless of candidate count,
 * folder filter, review status, or classification. These tests prove
 * that structurally: an image-extension candidate always gets an
 * `<img>` node (never the text-only fallback), whether the result set
 * has 4 candidates or 150, and whether it's filtered to one folder or
 * shown under "All folders".
 */
function makeLargeCandidateSet(count: number): ConnectionCandidate[] {
  const items: ConnectionCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const isImage = i % 3 !== 0; // 2 out of every 3 are images, 1 in 3 is a non-image (pdf)
    items.push({
      id: `bulk-${i}`,
      originalPath: `Bulk Folder/${isImage ? "photo" : "doc"}_${i}.${isImage ? "jpg" : "pdf"}`,
      originalFilename: `${isImage ? "photo" : "doc"}_${i}.${isImage ? "jpg" : "pdf"}`,
      reviewStatus: i % 2 === 0 ? "unreviewed" : "reviewed",
      inclusionDecision: i % 2 === 0 ? null : "include",
      evidenceTypeId: i % 2 === 0 ? null : "final_logo",
    });
  }
  return items;
}

describe("ConnectionsWorkspace — card rendering does not depend on result-set size or folder", () => {
  it("an image candidate renders an <img> thumbnail (not the text-only fallback) in a large, unfiltered 'All folders' result set", async () => {
    mockFetch(makeLargeCandidateSet(150));
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("photo_1.jpg")).toBeTruthy());

    const card = candidateOption("photo_1.jpg");
    // Not getByRole("img") — these thumbnails use alt="" (decorative),
    // which computes to ARIA role "none", not "img". A raw tag query is
    // the correct check here.
    expect(card.querySelector("img")).toBeTruthy();
    expect(within(card).queryByText("PDF")).toBeNull();
  });

  it("the same image candidate renders identically (an <img>, not a fallback) once filtered down to its own folder", async () => {
    mockFetch(makeLargeCandidateSet(150));
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("photo_1.jpg")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "Bulk Folder" } });
    const card = candidateOption("photo_1.jpg");
    expect(card.querySelector("img")).toBeTruthy();
  });

  it("an unclassified, unreviewed image candidate still gets the <img> thumbnail — card type is independent of review/classification status", async () => {
    mockFetch(makeLargeCandidateSet(150));
    render(<Harness />);
    // Even-indexed items are unreviewed + evidenceTypeId: null per makeLargeCandidateSet, and index 4 is an image (4 % 3 !== 0).
    await waitFor(() => expect(screen.getByText("photo_4.jpg")).toBeTruthy());
    const card = candidateOption("photo_4.jpg");
    expect(card.querySelector("img")).toBeTruthy();
    expect(within(card).getByText("Not reviewed")).toBeTruthy();
  });

  it("a non-image extension always gets the large file-type fallback, never an <img> tag", async () => {
    mockFetch(makeLargeCandidateSet(150));
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("doc_0.pdf")).toBeTruthy());
    const card = candidateOption("doc_0.pdf");
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByText("PDF")).toBeTruthy();
  });

  it("a 150-item candidate set does not force a compact/list-only layout — every visible image candidate still gets its own <img>", async () => {
    mockFetch(makeLargeCandidateSet(150));
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("photo_1.jpg")).toBeTruthy());

    const imageFilenames = ["photo_1.jpg", "photo_2.jpg", "photo_4.jpg", "photo_5.jpg"];
    for (const filename of imageFilenames) {
      expect(candidateOption(filename).querySelector("img")).toBeTruthy();
    }
  });
});
