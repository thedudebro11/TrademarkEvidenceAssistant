import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomePage } from "./HomePage.js";
import { RouterProvider } from "../app/router.js";
import { AppStateProvider } from "../app/AppStateContext.js";
import type { HealthResponse, MissingRecordsPreviewResponse, ReviewProgress } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const HEALTH: HealthResponse = {
  status: "ok",
  workspace: { name: "Fatletic", evidenceRoot: "/evidence", evidenceRootExists: true },
  database: { connected: true },
};

const EMPTY_MISSING_PREVIEW: MissingRecordsPreviewResponse = { confidentlyMissing: [], uncertain: [] };

function mockFetch(progress: ReviewProgress, missingPreview: MissingRecordsPreviewResponse = EMPTY_MISSING_PREVIEW) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/evidence-items/progress")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => progress });
      }
      if (url.includes("/missing-records/preview")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => missingPreview });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => HEALTH });
    }),
  );
}

function missingCandidate(overrides: Partial<MissingRecordsPreviewResponse["confidentlyMissing"][number]> = {}): MissingRecordsPreviewResponse["confidentlyMissing"][number] {
  return {
    evidenceItemId: "item-1",
    filename: "IMG_1.jpg",
    originalPath: "Customer Photos/IMG_1.jpg",
    folderPath: "Customer Photos",
    evidenceTypeId: null,
    reviewStatus: "unreviewed",
    inclusionDecision: null,
    connectionsCount: 0,
    notesCount: 0,
    answersCount: 0,
    fileSize: 1024,
    lastKnownModifiedAt: null,
    missingSince: "2026-07-01T00:00:00.000Z",
    availabilityReasonCode: "MISSING_FILE",
    dependencyCounts: { reviewAnswers: 0, connectionsOutgoing: 0, connectionsIncoming: 0, duplicateMemberships: 0, hasHeicPreview: false, hasNotes: false, bulkOperationReferences: 0, exportReferences: 0 },
    hasReviewedWork: false,
    ...overrides,
  };
}

function renderHome() {
  return render(
    <RouterProvider>
      <AppStateProvider>
        <HomePage />
      </AppStateProvider>
    </RouterProvider>,
  );
}

describe("HomePage", () => {
  it("offers Begin Scan before any evidence has been scanned", async () => {
    mockFetch({ total: 0, unreviewed: 0, reviewed: 0, needsFollowUp: 0, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Add your evidence")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Begin Scan/ })).toBeTruthy();
  });

  it("offers Start Review when items exist but none are reviewed yet", async () => {
    mockFetch({ total: 10, unreviewed: 10, reviewed: 0, needsFollowUp: 0, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Start reviewing")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Start Review/ })).toBeTruthy();
  });

  it("offers Continue Review once some items are reviewed", async () => {
    mockFetch({ total: 10, unreviewed: 4, reviewed: 6, needsFollowUp: 0, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Continue reviewing")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Continue Review/ })).toBeTruthy();
    expect(screen.getByText("6 of 10 reviewed")).toBeTruthy();
  });

  it("offers Prepare Package once every item has a decision, never a fabricated readiness claim", async () => {
    mockFetch({ total: 10, unreviewed: 0, reviewed: 8, needsFollowUp: 0, excluded: 2 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Review complete")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Prepare Package/ })).toBeTruthy();
    expect(screen.queryByText(/readiness/i)).toBeNull();
    expect(screen.queryByText(/first.use/i)).toBeNull();
  });

  it("regression: the main card's reviewed count and 'At a glance's Reviewed count always agree, even with needs-follow-up items present (real FATLETIC data: 216 total, 29 unreviewed, 30 reviewed, 1 needs-follow-up, 156 excluded)", async () => {
    mockFetch({ total: 216, unreviewed: 29, reviewed: 30, needsFollowUp: 1, excluded: 156 });
    renderHome();

    // Both must read 186 (reviewed + excluded), never 187 (total -
    // unreviewed) — a needs-follow-up item is not "reviewed".
    await waitFor(() => expect(screen.getByText("186 of 216 reviewed")).toBeTruthy());
    const atAGlanceReviewed = screen.getAllByText("186");
    expect(atAGlanceReviewed.length).toBeGreaterThan(0); // the "At a glance" card's own "Reviewed" figure
    expect(screen.queryByText("187")).toBeNull();
  });

  it("regression: 'Review complete' does not appear while a needs-follow-up item still needs attention, even with zero unreviewed items", async () => {
    mockFetch({ total: 10, unreviewed: 0, reviewed: 9, needsFollowUp: 1, excluded: 0 });
    renderHome();

    await waitFor(() => expect(screen.getByText("Continue reviewing")).toBeTruthy());
    expect(screen.queryByText("Review complete")).toBeNull();
    expect(screen.queryByRole("link", { name: /Prepare Package/ })).toBeNull();
  });

  it("shows the needs-follow-up count as informational text, not a broken link", async () => {
    mockFetch({ total: 10, unreviewed: 3, reviewed: 5, needsFollowUp: 2, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/2 items marked Needs Follow-Up/)).toBeTruthy();
    });
  });

  it("does not show 'Review Missing Files' when nothing is missing", async () => {
    mockFetch({ total: 10, unreviewed: 3, reviewed: 5, needsFollowUp: 2, excluded: 0 }, EMPTY_MISSING_PREVIEW);
    renderHome();

    await waitFor(() => expect(screen.getByText("Continue reviewing")).toBeTruthy());
    expect(screen.queryByText("Review Missing Files")).toBeNull();
  });

  it("shows the live missing count and a Review Missing Files action when records are missing", async () => {
    mockFetch({ total: 10, unreviewed: 3, reviewed: 5, needsFollowUp: 2, excluded: 0 }, { confidentlyMissing: [missingCandidate(), missingCandidate({ evidenceItemId: "item-2" })], uncertain: [] });
    renderHome();

    await waitFor(() => expect(screen.getByText("2 missing")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Review Missing Files" })).toBeTruthy();
  });

  it("opens the Missing Evidence Files modal and updates the count to zero after a successful removal", async () => {
    let removeCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/evidence-items/progress")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ total: 10, unreviewed: 3, reviewed: 5, needsFollowUp: 2, excluded: 0 }) });
        if (url.includes("/missing-records/preview")) {
          const body: MissingRecordsPreviewResponse = removeCalled ? { confidentlyMissing: [], uncertain: [] } : { confidentlyMissing: [missingCandidate()], uncertain: [] };
          return Promise.resolve({ ok: true, status: 200, json: async () => body });
        }
        if (url.includes("/missing-records/remove")) {
          removeCalled = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ operationId: 1, requestedCount: 1, removedCount: 1, skippedCount: 0, failedCount: 0, removed: [{ evidenceItemId: "item-1", filename: "IMG_1.jpg" }], skipped: [], status: "completed", backup: null }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => HEALTH });
      }),
    );
    renderHome();

    await waitFor(() => expect(screen.getByText("1 missing")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Review Missing Files" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Missing Evidence Files" })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1 Missing Record" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 Missing Record" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Permanently Remove Missing Records?" })).toBeTruthy());
    fireEvent.click(screen.getByLabelText("I understand these evidence records will be permanently removed."));
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 Missing Record" }));

    await waitFor(() => expect(screen.getByText(/1 missing evidence record removed\./)).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("Review Missing Files")).toBeNull());
  });

  it("keeps the Batch Analysis card compact — Review Suggestions only opens as a full-width section below, launched by an explicit action, never inline in the sidebar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/evidence-items/progress")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ total: 10, unreviewed: 3, reviewed: 5, needsFollowUp: 0, excluded: 2 }) });
        if (url.includes("/missing-records/preview")) return Promise.resolve({ ok: true, status: 200, json: async () => EMPTY_MISSING_PREVIEW });
        if (url.includes("/evidence-items/tree")) return Promise.resolve({ ok: true, status: 200, json: async () => [] });
        if (url === "/api/analysis/batch" && init?.method === "POST") return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
        if (url.match(/\/api\/analysis\/batch\/\d+$/)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 1,
              status: "completed",
              selectionMode: "all_unreviewed",
              selectionParam: null,
              totalCount: 3,
              processedCount: 3,
              succeededCount: 3,
              failedCount: 0,
              skippedCount: 0,
              currentItemId: null,
              currentFilename: null,
              currentFolder: null,
              createdAt: "x",
              startedAt: "x",
              finishedAt: "x",
              cancellationRequested: false,
              errorSummary: null,
              deterministicRuleVersion: "1",
              evidenceTypeRegistryVersion: "1.0",
              providerAvailable: false,
              readyForReview: true,
            }),
          });
        }
        if (url.includes("/analysis/suggestions-queue")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [], total: 0 }) });
        return Promise.resolve({ ok: true, status: 200, json: async () => HEALTH });
      }),
    );
    renderHome();

    await waitFor(() => expect(screen.getByText("Batch Analysis")).toBeTruthy());
    expect(screen.queryByLabelText("Review Suggestions workspace")).toBeNull(); // not shown until launched

    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    const launchButton = await screen.findByRole("button", { name: "Review 3 Suggestions" });
    fireEvent.click(launchButton);

    await waitFor(() => expect(screen.getByLabelText("Review Suggestions workspace")).toBeTruthy());
  });
});
