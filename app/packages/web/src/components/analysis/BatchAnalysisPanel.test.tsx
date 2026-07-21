import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BatchAnalysisPanel } from "./BatchAnalysisPanel.js";
import type { BatchAnalysisJobStatus } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

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
  it("starts 'Analyze All Unreviewed' and shows a completed summary with succeeded/failed/skipped counts", async () => {
    mockFetch([job({ status: "completed", processedCount: 3, succeededCount: 3, readyForReview: true })]);
    render(<BatchAnalysisPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(screen.getByText(/3 total/)).toBeTruthy());
    expect(screen.getByText(/3 succeeded/)).toBeTruthy();
    expect(screen.getByText(/ready for review/i)).toBeTruthy();
  });

  it("calls onReadyForReview once the job reaches a successful terminal state", async () => {
    mockFetch([job({ status: "completed", readyForReview: true })]);
    const onReady = vi.fn();
    render(<BatchAnalysisPanel onReadyForReview={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze All Unreviewed" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(1));
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

  it("Analyze Folder sends the typed folder path", async () => {
    let capturedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/analysis/batch" && init?.method === "POST") {
          capturedBody = JSON.parse((init.body as string) ?? "{}");
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => job({ status: "completed" }) });
      }),
    );
    render(<BatchAnalysisPanel />);
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "Customer Photos" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze Folder" }));
    await waitFor(() => expect(capturedBody).toMatchObject({ selectionMode: "folder", folderPath: "Customer Photos" }));
  });
});
