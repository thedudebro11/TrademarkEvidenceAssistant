import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HomePage } from "./HomePage.js";
import { RouterProvider } from "../app/router.js";
import { AppStateProvider } from "../app/AppStateContext.js";
import type { HealthResponse, ReviewProgress } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const HEALTH: HealthResponse = {
  status: "ok",
  workspace: { name: "Fatletic", evidenceRoot: "/evidence", evidenceRootExists: true },
  database: { connected: true },
};

function mockFetch(progress: ReviewProgress) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/evidence-items/progress")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => progress });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => HEALTH });
    }),
  );
}

function renderHome() {
  return render(
    <RouterProvider>
      <AppStateProvider>
        <HomePage />
      </AppStateProvider>
    </RouterProvider>,
  );
}

describe("HomePage", () => {
  it("offers Begin Scan before any evidence has been scanned", async () => {
    mockFetch({ total: 0, unreviewed: 0, reviewed: 0, needsFollowUp: 0, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Add your evidence")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Begin Scan/ })).toBeTruthy();
  });

  it("offers Start Review when items exist but none are reviewed yet", async () => {
    mockFetch({ total: 10, unreviewed: 10, reviewed: 0, needsFollowUp: 0, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Start reviewing")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Start Review/ })).toBeTruthy();
  });

  it("offers Continue Review once some items are reviewed", async () => {
    mockFetch({ total: 10, unreviewed: 4, reviewed: 6, needsFollowUp: 0, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Continue reviewing")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Continue Review/ })).toBeTruthy();
    expect(screen.getByText("6 of 10 reviewed")).toBeTruthy();
  });

  it("offers Prepare Package once every item has a decision, never a fabricated readiness claim", async () => {
    mockFetch({ total: 10, unreviewed: 0, reviewed: 8, needsFollowUp: 0, excluded: 2 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Review complete")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Prepare Package/ })).toBeTruthy();
    expect(screen.queryByText(/readiness/i)).toBeNull();
    expect(screen.queryByText(/first.use/i)).toBeNull();
  });

  it("shows the needs-follow-up count as informational text, not a broken link", async () => {
    mockFetch({ total: 10, unreviewed: 3, reviewed: 5, needsFollowUp: 2, excluded: 0 });
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/2 items marked Needs Follow-Up/)).toBeTruthy();
    });
  });
});
