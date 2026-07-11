import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BinderPanel } from "./BinderPanel.js";
import type { BinderSummary } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("BinderPanel", () => {
  it("explains upfront that the binder is not legal advice", () => {
    render(<BinderPanel />);
    expect(screen.getByText(/not legal advice, and not proof of trademark rights/)).toBeTruthy();
  });

  it("generates a binder and displays the resulting summary", async () => {
    const summary: BinderSummary = {
      binderGenerationId: 1,
      exportId: 1,
      itemCount: 5,
      outputPaths: {
        markdown: "/reports/Fatletic/export-1/binder.md",
        html: "/reports/Fatletic/export-1/binder.html",
        json: "/reports/Fatletic/export-1/binder.json",
        csv: "/reports/Fatletic/export-1/exhibits.csv",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => summary }));

    render(<BinderPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Evidence Binder" }));

    await waitFor(() => {
      expect(screen.getByText(/Evidence Binder Generated/)).toBeTruthy();
    });
    expect(screen.getByText(/5 exhibits/)).toBeTruthy();
  });

  it("shows a clear error directing the user to export first, and reassures originals were untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "No completed export found for this workspace. Generate an evidence package first." }),
      }),
    );

    render(<BinderPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Evidence Binder" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Generate an evidence package first");
    });
    expect(screen.getByRole("alert").textContent).toContain("not affected");
  });
});
