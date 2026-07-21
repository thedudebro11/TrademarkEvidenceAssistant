import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuestionsPanel } from "./QuestionsPanel.js";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const baseItem: EvidenceItemDetail = {
  id: "item-1",
  originalPath: "photo.jpg",
  originalFilename: "photo.jpg",
  extension: "jpg",
  mimeType: "image/jpeg",
  fileSize: 100,
  sha256: "abc",
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fsCreatedAt: null,
  fsModifiedAt: null,
  missingSince: null,
  reviewStatus: "unreviewed",
  inclusionDecision: null,
  notes: null,
  notesUpdatedAt: null,
  decidedAt: null,
  metadata: null,
  duplicates: [],
  fileRole: null,
  answers: [],
  connections: [],
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
  evidenceType: null,
  evidenceTypeSuggestion: null,
  noRelatedEvidence: false,
};

describe("QuestionsPanel", () => {
  it("shows only universal questions when no role is assigned", () => {
    render(<QuestionsPanel item={baseItem} onRoleChange={() => {}} />);
    expect(screen.getByText("What is this file?")).toBeTruthy();
    expect(screen.queryByText("Was this item sold, gifted, or a sample?")).toBeNull();
  });

  it("assigning a role calls the API and notifies the parent with the updated item", async () => {
    const updatedItem = { ...baseItem, fileRole: "product_photo" as const };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => updatedItem }),
    );
    const onRoleChange = vi.fn();

    render(<QuestionsPanel item={baseItem} onRoleChange={onRoleChange} />);
    fireEvent.change(screen.getByLabelText("File role"), { target: { value: "product_photo" } });

    await waitFor(() => {
      expect(onRoleChange).toHaveBeenCalledWith(updatedItem);
    });
  });

  it("shows image-specific questions once the item has an image role", () => {
    const item = { ...baseItem, fileRole: "product_photo" as const };
    render(<QuestionsPanel item={item} onRoleChange={() => {}} />);
    expect(screen.getByText("Was this item sold, gifted, or a sample?")).toBeTruthy();
  });

  it("blurring an answered question field saves the answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          questionId: "universal_what_is_this",
          value: "A product photo",
          source: "user",
          confidence: null,
          note: null,
          answeredAt: "2026-01-01T00:00:00.000Z",
        }),
      }),
    );

    render(<QuestionsPanel item={baseItem} onRoleChange={() => {}} />);
    const input = screen.getByLabelText("What is this file?");
    fireEvent.change(input, { target: { value: "A product photo" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getAllByText("Saved").length).toBeGreaterThan(0);
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/evidence-items/item-1/answers/universal_what_is_this");
    expect(JSON.parse(init.body).value).toBe("A product photo");
  });

  it("pre-fills an existing answer's value", () => {
    const item = {
      ...baseItem,
      answers: [
        {
          questionId: "universal_what_is_this",
          value: "Existing answer",
          source: "user",
          confidence: "high" as const,
          note: null,
          answeredAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    render(<QuestionsPanel item={item} onRoleChange={() => {}} />);
    expect(screen.getByLabelText("What is this file?")).toHaveProperty("value", "Existing answer");
  });
});
