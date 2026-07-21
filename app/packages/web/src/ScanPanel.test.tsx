import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScanPanel } from "./ScanPanel.js";
import type { ScanSummary } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ScanPanel", () => {
  it("shows a guidance message instead of a scan button when there is no evidence root", () => {
    render(<ScanPanel evidenceRootExists={false} />);

    expect(screen.getByText(/No evidence folder was found/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("runs a scan and displays the resulting summary", async () => {
    const summary: ScanSummary = {
      scanRunId: 1,
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      filesDiscovered: 8,
      itemsCreated: 8,
      itemsUpdated: 0,
      itemsUnchanged: 0,
      itemsContentChanged: 0,
      itemsMissing: 0,
      duplicateGroups: 1,
      errorMessage: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => summary,
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Begin Scan" }));

    await waitFor(() => {
      expect(screen.getByText(/8 files discovered/)).toBeTruthy();
    });
    expect(screen.getByText(/1 duplicate group/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rescan Evidence" })).toBeTruthy();
  });

  it("23. 'Generate Missing Previews' starts a backfill job and polls it to completion without one request per file", async () => {
    let statusCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/heic-previews/backfill/")) {
          statusCallCount++;
          const done = statusCallCount >= 2;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ id: 1, status: done ? "completed" : "running", startedAt: "2026-01-01T00:00:00.000Z", completedAt: done ? "2026-01-01T00:00:01.000Z" : null, totalCount: 3, processedCount: done ? 3 : 1, succeededCount: done ? 3 : 1, failedCount: 0, skippedCount: 0 }),
          });
        }
        if (url.includes("/heic-previews/backfill")) {
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
        }
        throw new Error(`Unmocked fetch: ${url}`);
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Missing Previews" }));

    // ScanPanel polls on a real 1500ms interval (BACKFILL_POLL_INTERVAL_MS) — waitFor's
    // default 1000ms timeout is shorter than one poll cycle, so it must be raised here.
    await waitFor(() => expect(screen.getByText(/3 previews generated/)).toBeTruthy(), { timeout: 5000 });
  });

  it("a backfill job that is already terminal on the very first status fetch (nothing to process) shows the final result immediately, never stuck on '0 of N processed'", async () => {
    // Reproduces the actual reported bug: when every HEIC item already has
    // a current preview, the server-side job finishes synchronously fast
    // enough that its status is already 'completed' by the time the
    // client's *first* poll resolves — there is no second poll to ever
    // observe a transition away from "running".
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/heic-previews/backfill/")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 7,
              status: "completed",
              createdAt: "2026-01-01T00:00:00.000Z",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:00:00.000Z",
              totalCount: 5,
              processedCount: 0,
              succeededCount: 0,
              failedCount: 0,
              skippedCount: 5,
              errorMessage: null,
            }),
          });
        }
        if (url.includes("/heic-previews/backfill")) {
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 7 }) });
        }
        throw new Error(`Unmocked fetch: ${url}`);
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Missing Previews" }));

    await waitFor(() => expect(screen.getByText(/already had a current preview/)).toBeTruthy());
    expect(screen.queryByText(/processed\./)).toBeNull(); // never stuck showing "0 of 5 processed"
  });

  it("uses the job id returned by the start request for every subsequent poll", async () => {
    const polledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/heic-previews/backfill/")) {
          polledUrls.push(url);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ id: 42, status: "completed", createdAt: "x", startedAt: "x", completedAt: "x", totalCount: 1, processedCount: 1, succeededCount: 1, failedCount: 0, skippedCount: 0, errorMessage: null }),
          });
        }
        if (url.includes("/heic-previews/backfill")) {
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 42 }) });
        }
        throw new Error(`Unmocked fetch: ${url}`);
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Missing Previews" }));

    await waitFor(() => expect(polledUrls.length).toBeGreaterThan(0));
    expect(polledUrls.every((u) => u.includes("/heic-previews/backfill/42"))).toBe(true);
  });

  it("polling terminates (no further requests) once the job reaches a terminal status", async () => {
    let statusCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/heic-previews/backfill/")) {
          statusCallCount++;
          const done = statusCallCount >= 2;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ id: 1, status: done ? "completed" : "running", createdAt: "x", startedAt: "x", completedAt: done ? "x" : null, totalCount: 1, processedCount: done ? 1 : 0, succeededCount: done ? 1 : 0, failedCount: 0, skippedCount: 0, errorMessage: null }),
          });
        }
        if (url.includes("/heic-previews/backfill")) {
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
        }
        throw new Error(`Unmocked fetch: ${url}`);
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Missing Previews" }));

    await waitFor(() => expect(screen.getByText(/1 preview generated/)).toBeTruthy(), { timeout: 5000 });
    const countAtCompletion = statusCallCount;
    await new Promise((resolve) => setTimeout(resolve, 2000)); // longer than one poll interval
    expect(statusCallCount).toBe(countAtCompletion); // no further polling after the terminal status
  }, 10000);

  it("displays a Retry button and re-triggers the backfill when a job completes with failures", async () => {
    let generateCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/heic-previews/backfill/")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: generateCallCount,
              status: "completed_with_failures",
              createdAt: "x",
              startedAt: "x",
              completedAt: "x",
              totalCount: 2,
              processedCount: 2,
              succeededCount: 1,
              failedCount: 1,
              skippedCount: 0,
              errorMessage: null,
            }),
          });
        }
        if (url.includes("/heic-previews/backfill")) {
          generateCallCount++;
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: generateCallCount }) });
        }
        throw new Error(`Unmocked fetch: ${url}`);
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Missing Previews" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(generateCallCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(generateCallCount).toBe(2));
  });

  it("displays a Retry button when a job was interrupted (abandoned by a server restart)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/heic-previews/backfill/")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 1,
              status: "interrupted",
              createdAt: "x",
              startedAt: "x",
              completedAt: "x",
              totalCount: 5,
              processedCount: 2,
              succeededCount: 2,
              failedCount: 0,
              skippedCount: 0,
              errorMessage: "The server restarted while this job was running",
            }),
          });
        }
        if (url.includes("/heic-previews/backfill")) {
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ jobId: 1 }) });
        }
        throw new Error(`Unmocked fetch: ${url}`);
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Missing Previews" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.getByText(/interrupted before it could finish/)).toBeTruthy();
  });

  it("shows a plain-language error and never modifies originals on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Evidence root does not exist" }),
      }),
    );

    render(<ScanPanel evidenceRootExists={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Begin Scan" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Evidence root does not exist");
    });
    expect(screen.getByRole("alert").textContent).toContain("not affected");
  });
});
