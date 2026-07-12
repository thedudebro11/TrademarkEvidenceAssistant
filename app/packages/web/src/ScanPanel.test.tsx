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
