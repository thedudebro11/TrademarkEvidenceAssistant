import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportPanel } from "./ExportPanel.js";
import type { ExportSummary } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ExportPanel", () => {
  it("explains that only Include-decision files are copied and originals stay untouched before any action", () => {
    render(<ExportPanel />);
    expect(screen.getByText(/Only files you marked Include will be copied/)).toBeTruthy();
    expect(screen.getByText(/Original evidence remains untouched/)).toBeTruthy();
  });

  it("runs an export and displays the resulting summary", async () => {
    const summary: ExportSummary = {
      exportId: 1,
      status: "completed",
      exportPath: "/exports/Fatletic/2026-01-01/TrademarkEvidencePackage",
      itemsExported: 12,
      errorMessage: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => summary }));

    render(<ExportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Evidence Package" }));

    await waitFor(() => {
      expect(screen.getByText(/Evidence Package Generated/)).toBeTruthy();
    });
    expect(screen.getByText(/12 files copied and verified byte-for-byte/)).toBeTruthy();
  });

  it("shows a plain-language error and reassures originals were not affected on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Copy verification failed" }) }),
    );

    render(<ExportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Evidence Package" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Copy verification failed");
    });
    expect(screen.getByRole("alert").textContent).toContain("not affected");
  });
});
