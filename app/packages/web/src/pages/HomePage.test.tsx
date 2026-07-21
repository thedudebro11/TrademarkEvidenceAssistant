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
});
