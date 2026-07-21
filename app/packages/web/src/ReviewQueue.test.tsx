import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReviewQueue } from "./ReviewQueue.js";
import type { ConnectionCandidate, EvidenceItemDetail, ReviewProgress } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const baseItem: EvidenceItemDetail = {
  id: "item-1",
  originalPath: "product_photo.jpg",
  originalFilename: "product_photo.jpg",
  extension: "jpg",
  mimeType: "image/jpeg",
  fileSize: 912,
  sha256: "abc123",
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fsCreatedAt: "2026-01-01T00:00:00.000Z",
  fsModifiedAt: "2026-01-01T00:00:00.000Z",
  missingSince: null,
  reviewStatus: "unreviewed",
  inclusionDecision: null,
  notes: null,
  notesUpdatedAt: null,
  decidedAt: null,
  metadata: { width: 60, height: 40, pageCount: null },
  duplicates: [],
  fileRole: null,
  answers: [],
  connections: [],
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
  evidenceType: { typeId: "final_logo", registryVersion: "1.0", confidence: null, reason: null, source: "user", confirmedAt: "2026-01-01T00:00:00.000Z" },
  evidenceTypeSuggestion: null,
  noRelatedEvidence: false,
};

const zeroProgress: ReviewProgress = { total: 0, unreviewed: 0, reviewed: 0, needsFollowUp: 0, excluded: 0 };
const oneItemProgress: ReviewProgress = { total: 1, unreviewed: 1, reviewed: 0, needsFollowUp: 0, excluded: 0 };
const decidedProgress: ReviewProgress = { total: 1, unreviewed: 0, reviewed: 1, needsFollowUp: 0, excluded: 0 };

function mockFetchSequence(handlers: Record<string, (url: string, init?: RequestInit) => unknown>) {
  // ConnectionsWorkspace fetches its candidate list whenever it opens
  // (the large drawer, not the compact Connect panel), and
  // EvidenceTreePanel fetches the tree on every render — default both to
  // empty so tests that don't care about them don't need to mock either.
  const withDefaults: Record<string, (url: string, init?: RequestInit) => unknown> = {
    "/evidence-items/candidates": () => [],
    "/evidence-items/tree": () => [],
    ...handlers,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      for (const [pattern, handler] of Object.entries(withDefaults)) {
        if (url.includes(pattern)) {
          const body = handler(url, init);
          if (body === null) {
            return Promise.resolve({ ok: true, status: 204, json: async () => null });
          }
          if (body instanceof Error) {
            return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: body.message }) });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => body });
        }
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

describe("ReviewQueue", () => {
  it("shows the empty state when no evidence has been scanned", async () => {
    mockFetchSequence({ "/evidence-items/progress": () => zeroProgress });
    render(<ReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText(/No evidence has been scanned/)).toBeTruthy();
    });
  });

  it("loads and displays the first item for review", async () => {
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => {
      expect(screen.getByAltText("product_photo.jpg")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.getByText("60 × 40")).toBeTruthy();
  });

  it("test 1 — Identify answers remain in the DOM after opening Connections and returning to Identify", async () => {
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    // Identify is open by default (item.evidenceType is already confirmed, so the interview renders immediately).
    fireEvent.change(screen.getByLabelText("Is this your official, adopted logo?"), { target: { value: "yes, this is current" } });
    expect((screen.getByLabelText("Is this your official, adopted logo?") as HTMLInputElement).value).toBe("yes, this is current");

    // Switch to Connect — this unmounts EvidenceTypePanel (Accordion only renders the open section).
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    expect(screen.queryByLabelText("Is this your official, adopted logo?")).toBeNull();

    // Switch back to Identify.
    fireEvent.click(screen.getByRole("button", { name: /Identify/ }));
    expect((screen.getByLabelText("Is this your official, adopted logo?") as HTMLInputElement).value).toBe("yes, this is current");
  });

  it("test 9 — switching accordion sections alone never shows the Unsaved changes indicator", async () => {
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    fireEvent.click(screen.getByRole("button", { name: /Evaluate/ }));
    fireEvent.click(screen.getByRole("button", { name: /Identify/ }));

    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("test 8 — clicking Previous with unsaved changes warns before discarding, and does not proceed on cancel", async () => {
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Is this your official, adopted logo?"), { target: { value: "edited" } });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    // Field value is untouched because navigation was cancelled.
    expect((screen.getByLabelText("Is this your official, adopted logo?") as HTMLInputElement).value).toBe("edited");
    confirmSpy.mockRestore();
  });

  it("test 8b — an unsaved draft registers an app-level navigation guard that blocks in-app navigation (e.g. sidebar links) until confirmed", async () => {
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
    });
    const { RouterProvider, useRouter } = await import("./app/router.js");

    function NavigateToSettingsButton() {
      const { navigate, path } = useRouter();
      return (
        <>
          <span data-testid="current-path">{path}</span>
          <button onClick={() => navigate("/settings")}>Go to Settings</button>
        </>
      );
    }

    render(
      <RouterProvider>
        <NavigateToSettingsButton />
        <ReviewQueue />
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Is this your official, adopted logo?"), { target: { value: "edited" } });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Go to Settings" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("unsaved changes"));
    expect(screen.getByTestId("current-path").textContent).not.toBe("/settings");

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Go to Settings" }));
    expect(screen.getByTestId("current-path").textContent).toBe("/settings");

    confirmSpy.mockRestore();
  });

  it("test 5 — Save & Next sends the complete draft (interview answer, notes, and no decision) in one PUT call", async () => {
    let sentBody: unknown = null;
    mockFetchSequence({
      "/evidence-items/progress": () => (sentBody ? decidedProgress : oneItemProgress),
      "/evidence-items/item-1/draft": (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return { ...baseItem, notes: (sentBody as { notes: string }).notes };
      },
      "/evidence-items/next": () => (sentBody ? null : baseItem),
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Is this your official, adopted logo?"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: /Notes/ }));
    fireEvent.change(screen.getByLabelText("Notes", { selector: "textarea" }), { target: { value: "Looks current." } });

    fireEvent.click(screen.getByRole("button", { name: "Save & Next" }));

    await waitFor(() => expect(sentBody).not.toBeNull());
    const body = sentBody as { interviewAnswers: Record<string, { value: string }>; notes: string; decisionAction: string | null };
    expect(body.interviewAnswers.final_logo_official.value).toBe("yes");
    expect(body.notes).toBe("Looks current.");
    expect(body.decisionAction).toBeNull();
  });

  it("test 7 — a successful save clears the old draft and loads the next item fresh", async () => {
    const secondItem: EvidenceItemDetail = { ...baseItem, id: "item-2", originalFilename: "second.jpg", originalPath: "second.jpg" };
    let saved = false;
    mockFetchSequence({
      "/evidence-items/progress": () => (saved ? decidedProgress : oneItemProgress),
      "/evidence-items/item-1/draft": () => {
        saved = true;
        return { ...baseItem, reviewStatus: "reviewed", inclusionDecision: "include" };
      },
      "/evidence-items/next": () => (saved ? secondItem : baseItem),
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Is this your official, adopted logo?"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Include" }));

    await waitFor(() => expect(screen.getByAltText("second.jpg")).toBeTruthy());
    // The new item's own (empty) draft is in effect — no leftover value from item-1's edit.
    expect((screen.getByLabelText("Is this your official, adopted logo?") as HTMLInputElement).value).toBe("");
  });

  it("test 6 — a failed save keeps the draft intact and shows an error, without advancing", async () => {
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
      "/evidence-items/item-1/draft": () => new Error("The server rejected this evidence type."),
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Is this your official, adopted logo?"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" }));

    await waitFor(() => expect(screen.getByText(/Could not save/)).toBeTruthy());
    // Still on the same item, and the edited value is still there.
    expect(screen.getByAltText("product_photo.jpg")).toBeTruthy();
    expect((screen.getByLabelText("Is this your official, adopted logo?") as HTMLInputElement).value).toBe("yes");
  });

  it("clicking Include records the decision and advances to complete when the queue is exhausted", async () => {
    let decisionCalled = false;
    mockFetchSequence({
      "/evidence-items/progress": () => (decisionCalled ? decidedProgress : oneItemProgress),
      "/evidence-items/item-1/draft": (_url, init) => {
        decisionCalled = true;
        const body = JSON.parse(String(init?.body));
        expect(body.decisionAction).toBe("include");
        return { ...baseItem, reviewStatus: "reviewed", inclusionDecision: "include" };
      },
      "/evidence-items/next": () => (decisionCalled ? null : baseItem),
    });

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Include" }));

    await waitFor(() => {
      expect(screen.getByText(/Review Complete/)).toBeTruthy();
    });
  });

  it("shows the missing-original state for an item whose file is gone", async () => {
    const missingItem: EvidenceItemDetail = { ...baseItem, missingSince: "2026-02-01T00:00:00.000Z" };
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => missingItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText(/can no longer be found on disk/)).toBeTruthy();
    });
  });

  it("shows the duplicate notice when an item has duplicate members", async () => {
    const dupItem: EvidenceItemDetail = {
      ...baseItem,
      duplicates: [{ evidenceItemId: "item-2", originalPath: "product_photo_duplicate.jpg" }],
    };
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => dupItem,
    });
    render(<ReviewQueue />);
    fireEvent.click(await screen.findByRole("button", { name: /Details/ }));
    await waitFor(() => {
      expect(screen.getByText(/exact byte-for-byte match/)).toBeTruthy();
    });
    expect(screen.getByText("product_photo_duplicate.jpg")).toBeTruthy();
  });

  it("shows the unsupported-preview state for a non-renderable extension", async () => {
    const psdItem: EvidenceItemDetail = { ...baseItem, extension: "psd", mimeType: "image/vnd.adobe.photoshop" };
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => psdItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText(/Preview is not available for \.psd files/)).toBeTruthy();
    });
  });

  it("keyboard shortcut 'i' records an Include decision through the same atomic draft save", async () => {
    let decisionAction: string | null = null;
    let decisionCalled = false;
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/item-1/draft": (_url, init) => {
        decisionCalled = true;
        decisionAction = JSON.parse(String(init?.body)).decisionAction;
        return { ...baseItem, reviewStatus: "reviewed", inclusionDecision: "include" };
      },
      "/evidence-items/next": () => (decisionCalled ? null : baseItem),
    });

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.keyDown(document, { key: "i" });

    await waitFor(() => {
      expect(decisionAction).toBe("include");
    });
  });

  it("'No Related Evidence' — checking the box in Connect, then Save & Next, persists noRelatedEvidence: true through the real draft save", async () => {
    let sentBody: unknown = null;
    mockFetchSequence({
      "/evidence-items/progress": () => (sentBody ? decidedProgress : oneItemProgress),
      "/evidence-items/item-1/draft": (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return { ...baseItem, connections: [] };
      },
      "/evidence-items/next": () => (sentBody ? null : baseItem),
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    fireEvent.click(screen.getByLabelText("No related evidence"));
    expect(screen.getByText("No related evidence", { selector: "strong" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save & Next" }));

    await waitFor(() => expect(sentBody).not.toBeNull());
    expect((sentBody as { noRelatedEvidence: boolean }).noRelatedEvidence).toBe(true);
    expect((sentBody as { connectionsToAdd: unknown[] }).connectionsToAdd).toEqual([]);
  });

  it("Connections Workspace — opening it from Connect, selecting a candidate, and linking it persists the correct connection through Save & Next", async () => {
    const candidates: ConnectionCandidate[] = [
      { id: "item-9", originalPath: "Proof Files/invoice_44821.pdf", originalFilename: "invoice_44821.pdf", reviewStatus: "reviewed", inclusionDecision: "include", evidenceTypeId: null },
    ];
    let sentBody: unknown = null;
    mockFetchSequence({
      "/evidence-items/candidates": () => candidates,
      "/evidence-items/progress": () => (sentBody ? decidedProgress : oneItemProgress),
      "/evidence-items/item-1/draft": (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return { ...baseItem, connections: [] };
      },
      "/evidence-items/next": () => (sentBody ? null : baseItem),
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    fireEvent.click(screen.getByRole("button", { name: /Browse Evidence to Link/ }));

    const dialog = await screen.findByRole("dialog", { name: /product_photo\.jpg/ });
    expect(dialog).toBeTruthy();

    const grid = within(dialog).getByRole("listbox", { name: "Evidence candidates" });
    await waitFor(() => expect(within(grid).getByText("invoice_44821.pdf")).toBeTruthy());
    fireEvent.click(within(grid).getByRole("option", { name: /invoice_44821\.pdf/ }));
    fireEvent.change(screen.getByLabelText("Why are these connected?"), { target: { value: "Matches the order." } });
    fireEvent.click(screen.getByRole("button", { name: "Link Evidence" }));

    // Linking closes the workspace and returns focus to the trigger — the
    // Connect panel now shows the pending connection.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Proof Files/invoice_44821.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save & Next" }));

    await waitFor(() => expect(sentBody).not.toBeNull());
    const connectionsToAdd = (sentBody as { connectionsToAdd: { targetPath: string; explanation: string }[] }).connectionsToAdd;
    expect(connectionsToAdd).toEqual([
      expect.objectContaining({ targetPath: "Proof Files/invoice_44821.pdf", explanation: "Matches the order." }),
    ]);
  });

  it("an already-archived item shows a status readout instead of the four decision buttons", async () => {
    const archivedItem: EvidenceItemDetail = { ...baseItem, reviewStatus: "excluded", inclusionDecision: "not_useful" };
    mockFetchSequence({
      "/evidence-items/progress": () => decidedProgress,
      "/evidence-items/next": () => archivedItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Include" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("an already-included item shows 'Included', and 'Change decision' reveals the buttons again", async () => {
    const includedItem: EvidenceItemDetail = { ...baseItem, reviewStatus: "reviewed", inclusionDecision: "include" };
    mockFetchSequence({
      "/evidence-items/progress": () => decidedProgress,
      "/evidence-items/next": () => includedItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change decision" }));
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByText("Included")).toBeNull();
  });

  it("keyboard shortcut 'x' does nothing on an already-decided item unless 'Change decision' was opened first", async () => {
    const includedItem: EvidenceItemDetail = { ...baseItem, reviewStatus: "reviewed", inclusionDecision: "include" };
    let decisionCalled = false;
    mockFetchSequence({
      "/evidence-items/progress": () => decidedProgress,
      "/evidence-items/next": () => includedItem,
      "/evidence-items/item-1/draft": () => {
        decisionCalled = true;
        return { ...includedItem, reviewStatus: "excluded", inclusionDecision: "not_useful" };
      },
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

    fireEvent.keyDown(document, { key: "x" });
    expect(decisionCalled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Change decision" }));
    fireEvent.keyDown(document, { key: "x" });
    await waitFor(() => expect(decisionCalled).toBe(true));
  });

  it("clicking a file in the tree sidebar jumps the review panel directly to it", async () => {
    const treeTargetItem: EvidenceItemDetail = { ...baseItem, id: "item-9", originalFilename: "other.jpg", originalPath: "other.jpg" };
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
      "/evidence-items/tree": () => [{ type: "file", id: "item-9", name: "other.jpg", reviewStatus: "unreviewed", inclusionDecision: null }],
      "/evidence-items/item-9": () => treeTargetItem,
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("other.jpg")).toBeTruthy());

    fireEvent.click(screen.getByText("other.jpg"));
    await waitFor(() => expect(screen.getByAltText("other.jpg")).toBeTruthy());
  });

  it("Save & Next after a tree jump resumes the original still-unreviewed anchor item, rather than skipping past it", async () => {
    const treeTargetItem: EvidenceItemDetail = { ...baseItem, id: "item-9", originalFilename: "other.jpg", originalPath: "other.jpg" };
    const resumedCalls: string[] = [];
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/next": () => baseItem,
      "/evidence-items/tree": () => [{ type: "file", id: "item-9", name: "other.jpg", reviewStatus: "unreviewed", inclusionDecision: null }],
      "/evidence-items/item-9/draft": () => ({ ...treeTargetItem, notes: "edited" }),
      "/evidence-items/item-9": () => treeTargetItem,
      "/evidence-items/item-1": (url) => {
        resumedCalls.push(url);
        return baseItem;
      },
    });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("other.jpg")).toBeTruthy());

    fireEvent.click(screen.getByText("other.jpg"));
    await waitFor(() => expect(screen.getByAltText("other.jpg")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Save & Next" }));

    // The anchor (item-1) was still unreviewed, so resuming re-fetches
    // it directly — not fetchNextItem, which would have skipped it.
    await waitFor(() => expect(resumedCalls.length).toBeGreaterThan(0));
    expect(screen.getByAltText("product_photo.jpg")).toBeTruthy();
  });

  describe("Archive Similar", () => {
    const productMockupItem: EvidenceItemDetail = {
      ...baseItem,
      evidenceType: { typeId: "product_mockup", registryVersion: "1.0", confidence: null, reason: null, source: "user", confirmedAt: "2026-01-01T00:00:00.000Z" },
      answers: [
        { questionId: "product_mockup_ever_produced", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "product_mockup_matching_record", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
      ],
    };

    it("69. the button only appears when the live review matches the concept-only Product Mockup template", async () => {
      mockFetchSequence({ "/evidence-items/progress": () => oneItemProgress, "/evidence-items/next": () => baseItem });
      render(<ReviewQueue />);
      await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());
      expect(screen.queryByRole("button", { name: /Archive Similar/ })).toBeNull();
    });

    it("opens the Archive Similar modal, showing the server preview, and applying it shows a success toast", async () => {
      mockFetchSequence({
        "/evidence-items/progress": () => oneItemProgress,
        "/evidence-items/next": () => productMockupItem,
        "/evidence-items/item-1/archive-similar/preview": () => ({
          sourceItem: { itemId: "item-1", filename: "product_photo.jpg", originalPath: "product_photo.jpg" },
          scope: { folderPath: "", evidenceTypeId: "product_mockup", mediaType: "image" },
          templateSummary: {},
          eligible: [{ itemId: "item-2", filename: "mockup_2.jpg", originalPath: "mockup_2.jpg", reviewStatus: "unreviewed", evidenceTypeId: null }],
          excluded: [],
          eligibleCount: 1,
          excludedCount: 0,
          previewToken: "tok-1",
        }),
        "/evidence-items/item-1/archive-similar/apply": () => ({
          operationId: 7,
          requestedCount: 2,
          appliedCount: 2,
          skippedCount: 0,
          failedCount: 0,
          skipped: [],
          status: "completed",
        }),
      });
      render(<ReviewQueue />);
      await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: /Archive Similar/ }));
      await waitFor(() => expect(screen.getByRole("dialog", { name: "Archive Similar Product Mockups" })).toBeTruthy());
      await waitFor(() => expect(screen.getByText("mockup_2.jpg")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Apply Review & Archive 1 Similar Files" }));

      await waitFor(() => expect(screen.getByText(/similar mockup.*reviewed and archived/)).toBeTruthy());
      expect(screen.queryByRole("dialog", { name: "Archive Similar Product Mockups" })).toBeNull();
    });

    const designMockupItem: EvidenceItemDetail = {
      ...baseItem,
      evidenceType: { typeId: "design_mockup", registryVersion: "1.0", confidence: null, reason: null, source: "user", confirmedAt: "2026-01-01T00:00:00.000Z" },
      answers: [
        { questionId: "design_mockup_internal_concept", value: "Yes", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_final_design", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_creator", value: "Oscar V. & Michael M.", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_publicly_released", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_related_psd", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_related_final_logo", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
      ],
    };

    it("63/64. Archive Similar appears for a valid Design Mockup review and opens the Design Mockup modal", async () => {
      mockFetchSequence({
        "/evidence-items/progress": () => oneItemProgress,
        "/evidence-items/next": () => designMockupItem,
        "/evidence-items/item-1/archive-similar/preview": () => ({
          presetId: "design_mockup",
          sourceItem: { itemId: "item-1", filename: "product_photo.jpg", originalPath: "product_photo.jpg" },
          scope: { folderPath: "", evidenceTypeId: "design_mockup", mediaType: "image" },
          templateSummary: {},
          derivedField: { questionId: "design_mockup_creation_date", source: "filesystem_last_modified", defaultConfidence: "medium" },
          eligible: [
            {
              itemId: "dm-2",
              filename: "concept_2.png",
              originalPath: "concept_2.png",
              reviewStatus: "unreviewed",
              evidenceTypeId: null,
              derivedAnswers: { design_mockup_creation_date: { value: "9/12/2024", confidence: "medium", note: "note" } },
            },
          ],
          excluded: [],
          eligibleCount: 1,
          excludedCount: 0,
          previewToken: "dm-tok-1",
        }),
      });
      render(<ReviewQueue />);
      await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: /Archive Similar/ }));
      await waitFor(() => expect(screen.getByRole("dialog", { name: "Archive Similar Design Mockups" })).toBeTruthy());
      expect(screen.getByText("concept_2.png")).toBeTruthy();
      expect(screen.getByText("9/12/2024")).toBeTruthy();
    });

    const earlierLogoIterationItem: EvidenceItemDetail = {
      ...baseItem,
      evidenceType: { typeId: "design_mockup", registryVersion: "1.0", confidence: null, reason: null, source: "user", confirmedAt: "2026-01-01T00:00:00.000Z" },
      answers: [
        { questionId: "design_mockup_internal_concept", value: "Yes", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_final_design", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_publicly_released", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_related_psd", value: "No", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        { questionId: "design_mockup_related_final_logo", value: "Yes", source: "user", confidence: "high", note: null, answeredAt: "2026-01-01T00:00:00.000Z" },
        // No design_mockup_creator answer at all — this preset must
        // still activate (it auto-defaults the creator in the modal).
      ],
    };

    it("1/7. Archive Similar opens the Earlier Logo Iterations modal for led-to-final=Yes even with no creator answer yet", async () => {
      mockFetchSequence({
        "/evidence-items/progress": () => oneItemProgress,
        "/evidence-items/next": () => earlierLogoIterationItem,
        "/evidence-items/item-1/archive-similar/preview": () => ({
          presetId: "design_mockup_earlier_logo_iteration",
          sourceItem: { itemId: "item-1", filename: "product_photo.jpg", originalPath: "product_photo.jpg" },
          scope: { folderPath: "", evidenceTypeId: "design_mockup", mediaType: "image" },
          templateSummary: {},
          derivedField: { questionId: "design_mockup_creation_date", source: "filesystem_last_modified", defaultConfidence: "medium" },
          eligible: [
            {
              itemId: "eli-2",
              filename: "logo_v2.png",
              originalPath: "logo_v2.png",
              reviewStatus: "unreviewed",
              evidenceTypeId: null,
              derivedAnswers: { design_mockup_creation_date: { value: "2/1/2023", confidence: "medium", note: "note" } },
            },
          ],
          excluded: [],
          eligibleCount: 1,
          excludedCount: 0,
          previewToken: "eli-tok-1",
        }),
      });
      render(<ReviewQueue />);
      await waitFor(() => expect(screen.getByAltText("product_photo.jpg")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: /Archive Similar/ }));
      await waitFor(() => expect(screen.getByRole("dialog", { name: "Archive Similar Earlier Logo Iterations" })).toBeTruthy());
      expect(screen.getByText("logo_v2.png")).toBeTruthy();
    });
  });
});
