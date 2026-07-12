import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import type { HealthResponse } from "@trademark-evidence-assistant/shared";

const HEALTH: HealthResponse = {
  status: "ok",
  workspace: {
    name: "Fatletic",
    evidenceRoot: "/repo/workspaces/Fatletic/evidence",
    evidenceRootExists: true,
  },
  database: { connected: true },
};

describe("App shell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => HEALTH }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the primary navigation with all four required routes", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /home/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^review$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /prepare package/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /settings/i })).toBeTruthy();
  });

  it("shows the workspace name once health resolves", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Fatletic")).toBeTruthy();
    });
  });

  it("defaults to the Home route", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /home/i }).getAttribute("aria-current")).toBe("page");
  });

  it("shows a visible, non-crashing error banner when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("network down");
    });
    // The shell itself must still render — an unreachable backend is not a crash.
    expect(screen.getByRole("link", { name: /home/i })).toBeTruthy();
  });

  it("navigates between routes via the sidebar", async () => {
    render(<App />);
    await waitFor(() => screen.getByText("Fatletic"));

    screen.getByRole("link", { name: /settings/i }).click();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /settings/i }).getAttribute("aria-current")).toBe("page");
    });
  });
});
