import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSuggestionsQueue } from "./ReviewSuggestionsQueue.js";
import type { SuggestionQueueItemView, SuggestionQueueResponse } from "@trademark-evidence-assistant/shared";

const { navigateMock, setPendingReviewItemIdMock } = vi.hoisted(() => ({ navigateMock: vi.fn(), setPendingReviewItemIdMock: vi.fn() }));
vi.mock("../../app/router.js", () => ({
  useRouter: () => ({ path: "/", navigate: navigateMock }),
  setPendingReviewItemId: setPendingReviewItemIdMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  cleanup();
});

function item(overrides: Partial<SuggestionQueueItemView> = {}): SuggestionQueueItemView {
  return {
    evidenceItemId: "item-1",
    filename: "photo.jpg",
    folder: "Customer Photos",
    analysisRunId: 1,
    suggestedEvidenceType: "customer_photo",
    alternativeEvidenceTypes: [],
    confidence: "low",
    answerSuggestionCount: 1,
    dateCount: 2,
    identifierCount: 0,
    connectionSuggestionCount: 0,
    hasContradiction: false,
    hasUnresolvedQuestion: true,
    failedExtraction: false,
    stale: false,
    providerAvailable: false,
    ...overrides,
  };
}

function mockQueueFetch(response: SuggestionQueueResponse, captureUrl?: (url: string) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      captureUrl?.(url);
      return Promise.resolve({ ok: true, status: 200, json: async () => response });
    }),
  );
}

describe("ReviewSuggestionsQueue", () => {
  it("shows a compact summary for each item: filename, folder, suggested type, confidence, counts", async () => {
    mockQueueFetch({ items: [item()], total: 1 });
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeTruthy());
    expect(screen.getByText("Customer Photos")).toBeTruthy();
    expect(screen.getByText("customer photo")).toBeTruthy();
    expect(screen.getByText("low")).toBeTruthy();
    expect(screen.getByText("unresolved question")).toBeTruthy();
  });

  it("shows an empty state when no items match", async () => {
    mockQueueFetch({ items: [], total: 0 });
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("No items match these filters.")).toBeTruthy());
  });

  it("opening an item navigates to Review after registering it as the pending item", async () => {
    mockQueueFetch({ items: [item()], total: 1 });
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeTruthy());
    fireEvent.click(screen.getByText("photo.jpg"));
    expect(setPendingReviewItemIdMock).toHaveBeenCalledWith("item-1");
    expect(navigateMock).toHaveBeenCalledWith("/review");
  });

  it("toggling the stale filter re-fetches with stale=true in the query", async () => {
    let lastUrl = "";
    mockQueueFetch({ items: [], total: 0 }, (url) => (lastUrl = url));
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(lastUrl).toContain("/api/analysis/suggestions-queue"));
    fireEvent.click(screen.getByLabelText(/stale/i, { selector: "input" }));
    await waitFor(() => expect(lastUrl).toContain("stale=true"));
  });

  it("scopes requests to a jobId when provided", async () => {
    let lastUrl = "";
    mockQueueFetch({ items: [], total: 0 }, (url) => (lastUrl = url));
    render(<ReviewSuggestionsQueue jobId={42} />);
    await waitFor(() => expect(lastUrl).toContain("jobId=42"));
  });

  it("shows an error message if the queue fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText(/Could not load the suggestions queue/)).toBeTruthy());
  });
});
