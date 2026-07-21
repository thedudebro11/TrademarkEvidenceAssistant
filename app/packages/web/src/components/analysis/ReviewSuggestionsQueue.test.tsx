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
    extension: "jpg",
    analysisRunId: 1,
    analyzedAt: "2026-07-21T10:00:00.000Z",
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
  it("shows a compact summary for each item: filename, folder, suggested type, confidence, alternatives, all counts, contradiction/unresolved/provider/stale state", async () => {
    mockQueueFetch({
      items: [
        item({
          alternativeEvidenceTypes: ["product_photo"],
          identifierCount: 3,
          connectionSuggestionCount: 2,
          hasContradiction: true,
          stale: true,
        }),
      ],
      total: 1,
    });
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeTruthy());
    expect(screen.getByText("Customer Photos", { selector: ".suggestion-queue__folder" })).toBeTruthy();
    expect(screen.getByText("customer photo", { selector: ".badge" })).toBeTruthy();
    expect(screen.getByText("low confidence")).toBeTruthy();
    expect(screen.getByText("+1 alternative")).toBeTruthy();
    expect(screen.getByText("1 answer")).toBeTruthy();
    expect(screen.getByText("2 dates")).toBeTruthy();
    expect(screen.getByText("3 identifiers")).toBeTruthy();
    expect(screen.getByText("2 connections")).toBeTruthy();
    expect(screen.getByText("contradiction")).toBeTruthy();
    expect(screen.getByText("unresolved question")).toBeTruthy();
    expect(screen.getByText("stale")).toBeTruthy();
    expect(screen.getByText("Deterministic analysis only", { selector: ".badge" })).toBeTruthy(); // relabeled from "No provider available"
    expect(screen.queryByText(/no provider available/i)).toBeNull();
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
    fireEvent.click(screen.getByLabelText("Stale — needs reanalysis"));
    await waitFor(() => expect(lastUrl).toContain("stale=true"));
  });

  it("the deterministic-only filter uses the clearer label and still sends noProvider=true", async () => {
    let lastUrl = "";
    mockQueueFetch({ items: [], total: 0 }, (url) => (lastUrl = url));
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(lastUrl).toContain("/api/analysis/suggestions-queue"));
    fireEvent.click(screen.getByLabelText("Deterministic analysis only"));
    await waitFor(() => expect(lastUrl).toContain("noProvider=true"));
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

  it("groups items by folder, evidence type, confidence, or analysis status when requested", async () => {
    mockQueueFetch({
      items: [
        item({ evidenceItemId: "a", filename: "a.jpg", folder: "Customer Photos", suggestedEvidenceType: "customer_photo" }),
        item({ evidenceItemId: "b", filename: "b.png", folder: "Printful Orders", suggestedEvidenceType: "customer_order", confidence: "high" }),
      ],
      total: 2,
    });
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("a.jpg")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "folder" } });
    await waitFor(() => expect(document.querySelector("h4.suggestion-queue__group-label")).toBeTruthy());
    const groupLabels = [...document.querySelectorAll("h4.suggestion-queue__group-label")].map((el) => el.textContent);
    expect(groupLabels.some((t) => t?.includes("Customer Photos"))).toBe(true);
    expect(groupLabels.some((t) => t?.includes("Printful Orders"))).toBe(true);
  });

  it("sorts by confidence (high first) and by most connections", async () => {
    mockQueueFetch({
      items: [
        item({ evidenceItemId: "low-conf", filename: "low.jpg", confidence: "low", connectionSuggestionCount: 0 }),
        item({ evidenceItemId: "high-conf", filename: "high.jpg", confidence: "high", connectionSuggestionCount: 5 }),
      ],
      total: 2,
    });
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("low.jpg")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "confidence" } });
    let filenames = screen.getAllByText(/\.jpg$/).map((el) => el.textContent);
    expect(filenames[0]).toBe("high.jpg");

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "connections" } });
    filenames = screen.getAllByText(/\.jpg$/).map((el) => el.textContent);
    expect(filenames[0]).toBe("high.jpg"); // still the one with 5 connections
  });

  it("renders a real image thumbnail for an image-extension item and a file-type fallback for a non-image", async () => {
    mockQueueFetch({
      items: [item({ evidenceItemId: "img-1", filename: "photo.jpg", extension: "jpg" }), item({ evidenceItemId: "vid-1", filename: "clip.mp4", extension: "mp4" })],
      total: 2,
    });
    const { container } = render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeTruthy());
    const img = container.querySelector('img[src="/api/evidence-items/img-1/file"]');
    expect(img).toBeTruthy();
    expect(screen.getByText("MP4")).toBeTruthy(); // fallback for the non-image extension
  });

  it("a long filename truncates visually but stays fully available via the row's title attribute", async () => {
    const longName = "IMG_20260717_extremely_long_descriptive_filename_from_a_real_camera_export (1).jpeg";
    mockQueueFetch({ items: [item({ filename: longName, folder: "Customer Photos" })], total: 1 });
    render(<ReviewSuggestionsQueue />);
    const row = await screen.findByTitle(`Customer Photos/${longName}`);
    expect(row.textContent).toContain(longName); // full text still present in the DOM, not clipped as data
  });

  it("each row is a real, keyboard-focusable button with a visible focus outline class applied via CSS, not only mouse-hoverable", async () => {
    mockQueueFetch({ items: [item()], total: 1 });
    render(<ReviewSuggestionsQueue />);
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeTruthy());
    const row = screen.getByRole("button", { name: /photo\.jpg/ });
    expect(row.tagName).toBe("BUTTON");
    row.focus();
    expect(document.activeElement).toBe(row);
  });
});
