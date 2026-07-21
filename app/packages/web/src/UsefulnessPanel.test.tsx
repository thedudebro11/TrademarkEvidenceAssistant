import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UsefulnessPanel } from "./UsefulnessPanel.js";
import type { DraftUsefulnessOverride } from "@trademark-evidence-assistant/shared";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  cleanup();
});

const NONE: DraftUsefulnessOverride = { action: "none", score: null, band: null, note: null };

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
  evidenceType: null,
  evidenceTypeSuggestion: null,
  noRelatedEvidence: false,
};

describe("UsefulnessPanel (controlled by the parent Review Draft)", () => {
  it("shows the computed band/score and never claims legal sufficiency", () => {
    render(<UsefulnessPanel item={baseItem} draftOverride={NONE} onSetOverride={() => {}} onRemoveOverride={() => {}} />);
    expect(screen.getByText("Weak", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/organizational aid only, not a legal conclusion/)).toBeTruthy();
  });

  it("always shows the computed reasoning even when a persisted override is active", () => {
    const overridden: EvidenceItemDetail = {
      ...baseItem,
      usefulness: {
        ...baseItem.usefulness,
        override: { score: 90, band: "Strong", note: "Verified in person.", overriddenAt: "2026-01-01T00:00:00.000Z" },
        effective: { score: 90, band: "Strong", positiveFactors: [], missingElements: [] },
      },
    };
    render(<UsefulnessPanel item={overridden} draftOverride={NONE} onSetOverride={() => {}} onRemoveOverride={() => {}} />);
    expect(screen.getByText(/Strong/)).toBeTruthy();
    expect(screen.getByText(/Verified in person\./)).toBeTruthy();
    expect(screen.getByText("Computed score: 35/100 (Weak)")).toBeTruthy();
  });

  it("submitting an override form calls onSetOverride — a staged callback, not a network request", () => {
    const onSetOverride = vi.fn();
    render(<UsefulnessPanel item={baseItem} draftOverride={NONE} onSetOverride={onSetOverride} onRemoveOverride={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Override this score" }));
    fireEvent.change(screen.getByLabelText("Score (0-100)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Band"), { target: { value: "Strong" } });
    fireEvent.change(screen.getByLabelText(/Why are you overriding/), { target: { value: "Verified in person." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Override" }));

    expect(onSetOverride).toHaveBeenCalledWith(90, "Strong", "Verified in person.");
  });

  it("a pending (not yet saved) override shows a distinct 'Pending override' message with an Undo action", () => {
    const pending: DraftUsefulnessOverride = { action: "set", score: 90, band: "Strong", note: "Verified in person." };
    const onRemoveOverride = vi.fn();
    render(<UsefulnessPanel item={baseItem} draftOverride={pending} onSetOverride={() => {}} onRemoveOverride={onRemoveOverride} />);

    expect(screen.getByText(/Pending override \(not yet saved\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo pending override" }));
    expect(onRemoveOverride).toHaveBeenCalled();
  });

  it("a pending clear of a persisted override shows the intent to remove it on save", () => {
    const overridden: EvidenceItemDetail = {
      ...baseItem,
      usefulness: { ...baseItem.usefulness, override: { score: 90, band: "Strong", note: "x", overriddenAt: "2026-01-01T00:00:00.000Z" } },
    };
    const pendingClear: DraftUsefulnessOverride = { action: "clear", score: null, band: null, note: null };
    render(<UsefulnessPanel item={overridden} draftOverride={pendingClear} onSetOverride={() => {}} onRemoveOverride={() => {}} />);
    expect(screen.getByText(/will be removed when you save/)).toBeTruthy();
  });

  it("removing a persisted override (no pending change yet) calls onRemoveOverride", () => {
    const overridden: EvidenceItemDetail = {
      ...baseItem,
      usefulness: { ...baseItem.usefulness, override: { score: 90, band: "Strong", note: "x", overriddenAt: "2026-01-01T00:00:00.000Z" } },
    };
    const onRemoveOverride = vi.fn();
    render(<UsefulnessPanel item={overridden} draftOverride={NONE} onSetOverride={() => {}} onRemoveOverride={onRemoveOverride} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove override" }));
    expect(onRemoveOverride).toHaveBeenCalled();
  });
});
