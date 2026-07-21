import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MissingRecordsModal } from "./MissingRecordsModal.js";
import type { MissingRecordCandidate, MissingRecordsPreviewResponse, RemoveMissingRecordsResponse } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function candidate(overrides: Partial<MissingRecordCandidate> = {}): MissingRecordCandidate {
  return {
    evidenceItemId: "item-1",
    filename: "IMG_1.jpg",
    originalPath: "Customer Photos/IMG_1.jpg",
    folderPath: "Customer Photos",
    evidenceTypeId: null,
    reviewStatus: "unreviewed",
    inclusionDecision: null,
    connectionsCount: 0,
    notesCount: 0,
    answersCount: 0,
    fileSize: 2048,
    lastKnownModifiedAt: "2026-01-01T00:00:00.000Z",
    missingSince: "2026-06-01T00:00:00.000Z",
    availabilityReasonCode: "MISSING_FILE",
    dependencyCounts: { reviewAnswers: 0, connectionsOutgoing: 0, connectionsIncoming: 0, duplicateMemberships: 0, hasHeicPreview: false, hasNotes: false, bulkOperationReferences: 0, exportReferences: 0 },
    hasReviewedWork: false,
    ...overrides,
  };
}

function mockFetch(preview: MissingRecordsPreviewResponse, removeResult?: RemoveMissingRecordsResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/missing-records/preview")) return Promise.resolve({ ok: true, status: 200, json: async () => preview });
      if (url.includes("/missing-records/remove")) return Promise.resolve({ ok: true, status: 200, json: async () => removeResult });
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

describe("MissingRecordsModal", () => {
  it("shows every confidently-missing record with filename, path, and folder", async () => {
    mockFetch({ confidentlyMissing: [candidate()], uncertain: [] });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByText("IMG_1.jpg")).toBeTruthy());
    expect(screen.getByText("Customer Photos/IMG_1.jpg")).toBeTruthy();
  });

  it("shows uncertain records separately, never pre-selected", async () => {
    mockFetch({ confidentlyMissing: [], uncertain: [candidate({ evidenceItemId: "item-uncertain", availabilityReasonCode: "DRIVE_UNAVAILABLE" })] });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Needs manual review/)).toBeTruthy());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the 'Contains reviewed evidence' warning badge only for records with review work", async () => {
    mockFetch({
      confidentlyMissing: [candidate({ evidenceItemId: "reviewed", filename: "reviewed.jpg", hasReviewedWork: true }), candidate({ evidenceItemId: "plain", filename: "plain.jpg", hasReviewedWork: false })],
      uncertain: [],
    });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByText("reviewed.jpg")).toBeTruthy());
    expect(screen.getByText("Contains reviewed evidence")).toBeTruthy();
  });

  it("Select all / Deselect all toggle every checkbox", async () => {
    mockFetch({ confidentlyMissing: [candidate({ evidenceItemId: "a", filename: "a.jpg" }), candidate({ evidenceItemId: "b", filename: "b.jpg" })], uncertain: [] });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getAllByRole("checkbox").every((cb) => !(cb as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getAllByRole("checkbox").every((cb) => (cb as HTMLInputElement).checked)).toBe(true);
  });

  it("filters by the search box on filename or path", async () => {
    mockFetch({ confidentlyMissing: [candidate({ evidenceItemId: "a", filename: "apple.jpg", originalPath: "Fruit/apple.jpg" }), candidate({ evidenceItemId: "b", filename: "banana.jpg", originalPath: "Fruit/banana.jpg" })], uncertain: [] });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByText("apple.jpg")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search missing files"), { target: { value: "banana" } });
    expect(screen.queryByText("apple.jpg")).toBeNull();
    expect(screen.getByText("banana.jpg")).toBeTruthy();
  });

  it("the first-step confirm button shows the selected count and advances to the final confirmation step", async () => {
    mockFetch({ confidentlyMissing: [candidate({ evidenceItemId: "a", filename: "a.jpg" }), candidate({ evidenceItemId: "b", filename: "b.jpg" })], uncertain: [] });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 2 Missing Records" })).toBeTruthy());
    fireEvent.click(screen.getAllByRole("checkbox")[0]); // deselect one
    expect(screen.getByRole("button", { name: "Remove 1 Missing Record" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove 1 Missing Record" }));
    expect(screen.getByRole("dialog", { name: "Permanently Remove Missing Records?" })).toBeTruthy();
  });

  it("does not allow submission on the final step until the confirmation checkbox is checked", async () => {
    mockFetch({ confidentlyMissing: [candidate()], uncertain: [] });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1 Missing Record" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 Missing Record" }));

    const confirmButton = screen.getAllByRole("button", { name: "Remove 1 Missing Record" })[0];
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("I understand these evidence records will be permanently removed."));
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("22. never sends the removal request until the final confirmation checkbox is checked and submitted", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/missing-records/preview")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ confidentlyMissing: [candidate()], uncertain: [] }) });
      throw new Error(`Unexpected call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1 Missing Record" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 Missing Record" }));
    // still on the confirm step, nothing submitted yet
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/missing-records/remove"))).toBe(false);
  });

  it("submits the removal request and calls onRemoved with the server's result once confirmed", async () => {
    const removeResult: RemoveMissingRecordsResponse = {
      operationId: 1,
      requestedCount: 1,
      removedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      removed: [{ evidenceItemId: "item-1", filename: "IMG_1.jpg" }],
      skipped: [],
      status: "completed",
      backup: null,
    };
    mockFetch({ confidentlyMissing: [candidate()], uncertain: [] }, removeResult);
    const onRemoved = vi.fn();
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={onRemoved} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1 Missing Record" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 Missing Record" }));
    fireEvent.click(screen.getByLabelText("I understand these evidence records will be permanently removed."));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove 1 Missing Record" })[0]);

    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(removeResult));
  });

  it("Back returns from the confirmation step to selection without losing the selection", async () => {
    mockFetch({ confidentlyMissing: [candidate()], uncertain: [] });
    render(<MissingRecordsModal open onClose={() => {}} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1 Missing Record" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 Missing Record" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("dialog", { name: "Missing Evidence Files" })).toBeTruthy();
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
  });

  it("Cancel closes the modal without calling the removal endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/missing-records/preview")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ confidentlyMissing: [candidate()], uncertain: [] }) });
      throw new Error(`Unexpected call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<MissingRecordsModal open onClose={onClose} onRemoved={() => {}} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
