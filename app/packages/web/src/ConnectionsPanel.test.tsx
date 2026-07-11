import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectionsPanel } from "./ConnectionsPanel.js";
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
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
};

describe("ConnectionsPanel", () => {
  it("shows a guiding empty state, not an apology, when there are no connections", () => {
    render(<ConnectionsPanel item={baseItem} onChanged={() => {}} refetchItem={async () => null} />);
    expect(screen.getByText("No related evidence has been linked yet.")).toBeTruthy();
  });

  it("renders existing connections with their direction and explanation", () => {
    const item = {
      ...baseItem,
      connections: [
        {
          connectionId: 1,
          direction: "outgoing" as const,
          relatedItemId: "item-2",
          relatedOriginalPath: "invoice.pdf",
          type: "product_to_invoice" as const,
          explanation: "Matches this order.",
          confidence: "high" as const,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    render(<ConnectionsPanel item={item} onChanged={() => {}} refetchItem={async () => null} />);
    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    expect(screen.getByText("Matches this order.")).toBeTruthy();
    expect(screen.getByText("Supports →")).toBeTruthy();
  });

  it("submitting the form creates a connection and notifies the parent with the refreshed item", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          sourceItemId: "item-1",
          targetItemId: "item-2",
          type: "related_to",
          explanation: "Same product",
          confidence: null,
          createdBy: "user",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      }),
    );
    const onChanged = vi.fn();
    const refreshedItem = { ...baseItem, connections: [{ connectionId: 1 }] } as unknown as EvidenceItemDetail;

    render(
      <ConnectionsPanel item={baseItem} onChanged={onChanged} refetchItem={async () => refreshedItem} />,
    );

    fireEvent.change(screen.getByLabelText("Related file's path"), { target: { value: "invoice.pdf" } });
    fireEvent.change(screen.getByLabelText("Why are these connected?"), {
      target: { value: "Same product" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link Evidence" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(refreshedItem);
    });
  });

  it("shows a plain-language error and never implies files were affected on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "No evidence item found at path \"missing.jpg\"" }),
      }),
    );

    render(<ConnectionsPanel item={baseItem} onChanged={() => {}} refetchItem={async () => null} />);
    fireEvent.change(screen.getByLabelText("Related file's path"), { target: { value: "missing.jpg" } });
    fireEvent.change(screen.getByLabelText("Why are these connected?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Link Evidence" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("No evidence item found");
    });
    expect(screen.getByRole("alert").textContent).toContain("not affected");
  });
});
