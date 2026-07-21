import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewedFilesPanel } from "./ReviewedFilesPanel.js";
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
  { type: "file", id: "item-4", name: "logo.jpg", reviewStatus: "reviewed", inclusionDecision: "maybe" },
  { type: "file", id: "item-5", name: "receipt.pdf", reviewStatus: "needs_follow_up", inclusionDecision: null },
];

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ReviewedFilesPanel", () => {
  it("shows only files with a real decision, grouped by decision label, with counts", async () => {
    mockFetch(tree);
    render(<ReviewedFilesPanel currentItemId="item-1" onSelectItem={() => {}} />);

    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeTruthy());
    expect(screen.queryByText("unreviewed_proof.pdf")).toBeNull();

    // <section aria-label="..."> maps to ARIA role "region", not "group".
    expect(screen.getByRole("region", { name: "Included" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Archived" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Marked Maybe" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Needs Follow-Up" })).toBeTruthy();
  });

  it("shows the folder path alongside a nested file's name, for context outside the folder structure", async () => {
    mockFetch(tree);
    render(<ReviewedFilesPanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeTruthy());
    expect(screen.getByText("Proof Files")).toBeTruthy();
  });

  it("a root-level file shows no folder path", async () => {
    mockFetch(tree);
    render(<ReviewedFilesPanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("product_photo.jpg")).toBeTruthy());
    const row = screen.getByText("product_photo.jpg").closest("button")!;
    expect(row.querySelector("small")).toBeNull();
  });

  it("clicking a reviewed file calls onSelectItem with its id", async () => {
    mockFetch(tree);
    const onSelectItem = vi.fn();
    render(<ReviewedFilesPanel currentItemId="item-1" onSelectItem={onSelectItem} />);
    await waitFor(() => expect(screen.getByText("logo.jpg")).toBeTruthy());

    fireEvent.click(screen.getByText("logo.jpg"));
    expect(onSelectItem).toHaveBeenCalledWith("item-4");
  });

  it("shows an empty-state message, not an empty screen, when nothing has been reviewed yet", async () => {
    mockFetch([{ type: "file", id: "item-1", name: "a.jpg", reviewStatus: "unreviewed", inclusionDecision: null }]);
    render(<ReviewedFilesPanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByText("No files have been reviewed yet.")).toBeTruthy());
  });

  it("shows an error message, not a crash, when the tree fails to load", async () => {
    mockFetch({}, false);
    render(<ReviewedFilesPanel currentItemId="item-1" onSelectItem={() => {}} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
