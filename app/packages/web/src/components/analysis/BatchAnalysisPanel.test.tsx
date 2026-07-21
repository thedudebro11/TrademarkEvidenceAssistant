import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BatchAnalysisPanel } from "./BatchAnalysisPanel.js";
import type { BatchAnalysisJobStatus, EvidenceTreeNode } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const TREE: EvidenceTreeNode[] = [
  {
    type: "folder",
    name: "Customer Photos",
    children: [{ type: "file", id: "item-cp-1", name: "photo1.jpg", reviewStatus: "unreviewed", inclusionDecision: null }],
  },
  {
    type: "folder",
    name: "Printful Orders",
    children: [{ type: "file", id: "item-po-1", name: "order1.png", reviewStatus: "unreviewed", inclusionDecision: null }],
  },
];

function job(overrides: Partial<BatchAnalysisJobStatus> = {}): BatchAnalysisJobStatus {
  return {
    id: 1,
    status: "running",
    selectionMode: "all_unreviewed",
    selectionParam: null,
    totalCount: 3,
    processedCount: 0,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
    currentItemId: null,
    currentFilename: null,
    currentFolder: null,
    createdAt: "x",
    startedAt: "x",
    finishedAt: null,
    cancellationRequested: false,
    errorSummary: null,
    deterministicRuleVersion: "1",
    evidenceTypeRegistryVersion: "1.0",
    providerAvailable: false,
    readyForReview: false,
    ...overrides,
  };
}

function mockFetch(statusSequence: BatchAnalysisJobStatus[], onCancel?: () => void) {
  let statusCallCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/evidence-items/tree")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => TREE });
      }
      if (url.includes("/cancel")) {
        onCancel?.();
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1, cancellationRequested: true }) });
      }
      if (url === "/api/analysis/batch" && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
      }
      if (url.match(/\/api\/analysis\/batch\/\d+$/)) {
        const status = statusSequence[Math.min(statusCallCount, statusSequence.length - 1)];
        statusCallCount++;
        return Promise.resolve({ ok: true, status: 200, json: async () => status });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

describe("BatchAnalysisPanel", () => {
  it("starts 'Analyze All Unreviewed' and shows a completed summary with succeeded/failed/skipped counts, plus a launch action rather than an automatic hand-off", async () => {
    mockFetch([job({ status: "completed", processedCount: 3, succeededCount: 3, readyForReview: true })]);
    render(<BatchAnalysisPanel onReadyForReview={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(screen.getByText(/3 total/)).toBeTruthy());
    expect(screen.getByText(/3 succeeded/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review 3 Suggestions" })).toBeTruthy();
  });

  it("calls onReadyForReview only after the explicit 'Review N Suggestions' action is clicked, never automatically", async () => {
    mockFetch([job({ status: "completed", succeededCount: 5, readyForReview: true })]);
    const onReady = vi.fn();
    render(<BatchAnalysisPanel onReadyForReview={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    const launchButton = await screen.findByRole("button", { name: "Review 5 Suggestions" });
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.click(launchButton);
    expect(onReady).toHaveBeenCalledWith(1);
  });

  it("shows a completed_with_failures state with a Retry Failed Items action, never claiming full success", async () => {
    mockFetch([job({ status: "completed_with_failures", processedCount: 3, succeededCount: 2, failedCount: 1, readyForReview: true })]);
    render(<BatchAnalysisPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(screen.getByText(/completed with failures/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Retry Failed Items" })).toBeTruthy();
  });

  it("shows an interrupted state distinctly, with no Retry Failed Items action (nothing failed, it was abandoned)", async () => {
    mockFetch([job({ status: "interrupted", processedCount: 1, errorSummary: "The server restarted while this job was running" })]);
    render(<BatchAnalysisPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(screen.getAllByText(/interrupted/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/server restarted/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Retry Failed Items" })).toBeNull();
  });

  it("shows a canceled state after Cancel is clicked mid-run", async () => {
    const onCancel = vi.fn();
    mockFetch(
      [job({ status: "running", processedCount: 1 }), job({ status: "canceled", processedCount: 1, skippedCount: 2 })],
      onCancel,
    );
    render(<BatchAnalysisPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/canceled/i)).toBeTruthy());
  });

  it("Retry Failed Items sends a retry_failed request against the just-completed job", async () => {
    mockFetch([job({ status: "completed_with_failures", failedCount: 1, readyForReview: true })]);
    render(<BatchAnalysisPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry Failed Items" })).toBeTruthy());

    let capturedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/analysis/batch" && init?.method === "POST") {
          capturedBody = JSON.parse((init.body as string) ?? "{}");
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 2 }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => job({ id: 2, status: "completed", readyForReview: true }) });
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry Failed Items" }));
    await waitFor(() => expect(capturedBody).toMatchObject({ selectionMode: "retry_failed", sourceJobId: 1 }));
  });

  it("the folder control is a selectable list populated from real evidence folders, not a free-text input", async () => {
    mockFetch([job({ status: "completed" })]);
    render(<BatchAnalysisPanel />);
    const select = (await screen.findByLabelText("Folder")) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const optionLabels = [...select.options].map((o) => o.textContent);
    expect(optionLabels).toContain("Customer Photos");
    expect(optionLabels).toContain("Printful Orders");
  });

  it("Analyze Folder sends the folder chosen from the real folder list", async () => {
    let capturedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/evidence-items/tree")) return Promise.resolve({ ok: true, status: 200, json: async () => TREE });
        if (url === "/api/analysis/batch" && init?.method === "POST") {
          capturedBody = JSON.parse((init.body as string) ?? "{}");
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => job({ status: "completed" }) });
      }),
    );
    render(<BatchAnalysisPanel />);
    const select = await screen.findByLabelText("Folder");
    fireEvent.change(select, { target: { value: "Customer Photos" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze Folder" }));
    await waitFor(() => expect(capturedBody).toMatchObject({ selectionMode: "folder", folderPath: "Customer Photos" }));
  });

  it("the searchable item picker finds real items by filename and analyzes exactly the checked ones", async () => {
    let capturedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/evidence-items/tree")) return Promise.resolve({ ok: true, status: 200, json: async () => TREE });
        if (url === "/api/analysis/batch" && init?.method === "POST") {
          capturedBody = JSON.parse((init.body as string) ?? "{}");
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => job({ status: "completed" }) });
      }),
    );
    render(<BatchAnalysisPanel />);
    const search = await screen.findByLabelText("Find items to analyze");
    fireEvent.change(search, { target: { value: "photo1" } });
    await waitFor(() => expect(screen.getByText("photo1.jpg")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Analyze Selected" }));
    await waitFor(() => expect(capturedBody).toMatchObject({ selectionMode: "selected_ids", itemIds: ["item-cp-1"] }));
  });

  it("the advanced item-id textarea is tucked behind a collapsed, clearly-labeled 'Advanced' disclosure, not a primary control", async () => {
    mockFetch([job({ status: "completed" })]);
    render(<BatchAnalysisPanel />);
    const disclosure = await screen.findByText("Advanced: analyze specific item IDs");
    const details = disclosure.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false); // collapsed by default — not a primary control
    fireEvent.click(disclosure);
    expect(details.open).toBe(true);
    expect(screen.getByLabelText("Item ids")).toBeTruthy();
  });

  it("shows the current filename and folder while a job runs, never only the raw evidence-item UUID", async () => {
    mockFetch([
      job({ status: "running", processedCount: 1, currentItemId: "a1b2c3d4e5f6", currentFilename: "IMG_2026.heic", currentFolder: "Customer Photos" }),
    ]);
    render(<BatchAnalysisPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(screen.getByText(/IMG_2026\.heic/)).toBeTruthy());
    expect(screen.getAllByText(/Customer Photos/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/a1b2c3d4e5f6/)).toBeNull();
  });
});
