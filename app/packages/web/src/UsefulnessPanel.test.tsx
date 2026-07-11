import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UsefulnessPanel } from "./UsefulnessPanel.js";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

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
  usefulness: {
    computed: { score: 35, band: "Weak", positiveFactors: ["A real-world date is documented."], missingElements: ["Mark visibility not yet documented."] },
    override: null,
    effective: { score: 35, band: "Weak", positiveFactors: ["A real-world date is documented."], missingElements: ["Mark visibility not yet documented."] },
  },
};

describe("UsefulnessPanel", () => {
  it("shows the computed band/score and never claims legal sufficiency", () => {
    render(<UsefulnessPanel item={baseItem} onChanged={() => {}} />);
    expect(screen.getByText("Weak", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/organizational aid only, not a legal conclusion/)).toBeTruthy();
  });

  it("always shows the computed reasoning even when an override is active", () => {
    const overridden: EvidenceItemDetail = {
      ...baseItem,
      usefulness: {
        ...baseItem.usefulness,
        override: { score: 90, band: "Strong", note: "Verified in person.", overriddenAt: "2026-01-01T00:00:00.000Z" },
        effective: { score: 90, band: "Strong", positiveFactors: [], missingElements: [] },
      },
    };
    render(<UsefulnessPanel item={overridden} onChanged={() => {}} />);
    expect(screen.getByText(/Strong/)).toBeTruthy();
    expect(screen.getByText(/Verified in person\./)).toBeTruthy();
    expect(screen.getByText("Computed score: 35/100 (Weak)")).toBeTruthy();
  });

  it("submitting an override requires a note and calls the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...baseItem, usefulness: { ...baseItem.usefulness, override: { score: 90, band: "Strong", note: "my reason", overriddenAt: "x" } } }),
      }),
    );
    const onChanged = vi.fn();
    render(<UsefulnessPanel item={baseItem} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Override this score" }));
    fireEvent.change(screen.getByLabelText("Why are you overriding the computed score?"), {
      target: { value: "my reason" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Override" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).note).toBe("my reason");
  });
});
