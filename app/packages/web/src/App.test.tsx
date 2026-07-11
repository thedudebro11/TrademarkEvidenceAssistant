import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import type { HealthResponse } from "@trademark-evidence-assistant/shared";

describe("App", () => {
  beforeEach(() => {
    const health: HealthResponse = {
      status: "ok",
      workspace: {
        name: "Fatletic",
        evidenceRoot: "/repo/workspaces/Fatletic/evidence",
        evidenceRootExists: true,
      },
      database: { connected: true },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => health,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders health status once the backend responds", async () => {
    render(<App />);

    expect(screen.getByText("Trademark Evidence Assistant")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Fatletic")).toBeTruthy();
    });
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("shows an error message when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("network down");
    });
  });

  it("shows a Review Evidence button once evidence has been scanned", async () => {
    const health: HealthResponse = {
      status: "ok",
      workspace: { name: "Fatletic", evidenceRoot: "/repo/evidence", evidenceRootExists: true },
      database: { connected: true },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/evidence-items/progress")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ total: 8, unreviewed: 8, reviewed: 0, needsFollowUp: 0, excluded: 0 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => health });
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Review Evidence")).toBeTruthy();
    });
  });
});
