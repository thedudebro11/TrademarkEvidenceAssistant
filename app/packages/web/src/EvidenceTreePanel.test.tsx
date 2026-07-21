import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EvidenceTreePanel } from "./EvidenceTreePanel.js";
import type { EvidenceTreeNode } from "@trademark-evidence-assistant/shared";

const tree: EvidenceTreeNode[] = [
  {
    type: "folder",
    name: "Proof Files",
    children: [
      { type: "file", id: "item-1", name: "invoice.pdf", reviewStatus: "reviewed", inclusionDecision: "include" },
      { type: "file", id: "item-2", name: "unreviewed_proof.pdf", reviewStatus: "unreviewed", inclusionDecision: null },
    ],
  },
  { type: "file", id: "item-3", name: "product_photo.jpg", reviewStatus: "excluded", inclusionDecision: "not_useful" },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => tree }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("EvidenceTreePanel", () => {
  it("fetches the tree once and renders root-level files and folders", async () => {
    render(<EvidenceTreePanel currentItemId="item-3" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("product_photo.jpg")).toBeTruthy());
    expect(screen.getByText("Proof Files")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/evidence-items/tree");
  });

  it("auto-expands the folder containing the current item, so it's visible without clicking", async () => {
    render(<EvidenceTreePanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeTruthy());
  });

  it("a folder not containing the current item starts collapsed", async () => {
    render(<EvidenceTreePanel currentItemId="item-3" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("Proof Files")).toBeTruthy());
    expect(screen.queryByText("invoice.pdf")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Proof Files/ }));
    expect(screen.getByText("invoice.pdf")).toBeTruthy();
  });

  it("shows a real decision status for a decided file and 'Not reviewed' for an untouched one — never a fabricated status", async () => {
    render(<EvidenceTreePanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeTruthy());
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.getByText("Not reviewed")).toBeTruthy();
  });

  it("clicking a file calls onSelectItem with its id", async () => {
    const onSelectItem = vi.fn();
    render(<EvidenceTreePanel currentItemId="item-1" onSelectItem={onSelectItem} />);
    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeTruthy());

    fireEvent.click(screen.getByText("product_photo.jpg"));
    expect(onSelectItem).toHaveBeenCalledWith("item-3");
  });

  it("marks the current item distinctly (aria-current) so it's identifiable in the tree", async () => {
    render(<EvidenceTreePanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeTruthy());
    const currentButton = screen.getByText("invoice.pdf").closest("button")!;
    expect(currentButton.getAttribute("aria-current")).toBe("true");

    const otherButton = screen.getByText("product_photo.jpg").closest("button")!;
    expect(otherButton.getAttribute("aria-current")).toBeNull();
  });

  it("shows an error message, not a crash, when the tree fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<EvidenceTreePanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
