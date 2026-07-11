import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewQueue } from "./ReviewQueue.js";
import type { EvidenceItemDetail, ReviewProgress } from "@trademark-evidence-assistant/shared";

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
};

const zeroProgress: ReviewProgress = { total: 0, unreviewed: 0, reviewed: 0, needsFollowUp: 0, excluded: 0 };
const oneItemProgress: ReviewProgress = { total: 1, unreviewed: 1, reviewed: 0, needsFollowUp: 0, excluded: 0 };
const decidedProgress: ReviewProgress = { total: 1, unreviewed: 0, reviewed: 1, needsFollowUp: 0, excluded: 0 };

function mockFetchSequence(handlers: Record<string, (url: string, init?: RequestInit) => unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) {
          const body = handler(url, init);
          if (body === null) {
            return Promise.resolve({ ok: true, status: 204, json: async () => null });
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
    expect(screen.getByText("60 × 40")).toBeTruthy();
  });

  it("clicking Include records the decision and advances to complete when the queue is exhausted", async () => {
    let decisionCalled = false;
    mockFetchSequence({
      "/evidence-items/progress": () => (decisionCalled ? decidedProgress : oneItemProgress),
      "/evidence-items/item-1/decision": () => {
        decisionCalled = true;
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

  it("keyboard shortcut 'i' records an Include decision", async () => {
    let decisionAction: string | null = null;
    let decisionCalled = false;
    mockFetchSequence({
      "/evidence-items/progress": () => oneItemProgress,
      "/evidence-items/item-1/decision": (_url, init) => {
        decisionCalled = true;
        decisionAction = JSON.parse(String(init?.body)).action;
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
});
