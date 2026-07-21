import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalysisPanel } from "./AnalysisPanel.js";
import type { AnalysisResultResponse } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function baseAnalysis(overrides: Partial<AnalysisResultResponse> = {}): AnalysisResultResponse {
  return {
    run: { id: 1, evidenceItemId: "item-1", sourceFingerprint: "sha-1", metadataVersion: "1", evidenceTypeRegistryVersion: "1.0", questionRegistryVersion: "1.0", deterministicRuleVersion: "1", status: "completed", initiatedAt: "x", completedAt: "x", providerId: null, providerModel: null, providerVersion: null, errorMessage: null, stale: false },
    evidenceTypeSuggestions: [],
    answerSuggestions: [],
    entities: [],
    dates: [],
    connectionSuggestions: [],
    retrievedExamples: [],
    summary: { answerCount: 0, dateCount: 0, identifierCount: 0, connectionCount: 0 },
    providerAvailable: false,
    ...overrides,
  };
}

function mockFetch(handlers: { onAnalyzePost?: () => AnalysisResultResponse; onGet?: () => AnalysisResultResponse | null; onConfirm?: (body: unknown) => unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/analysis/confirm")) {
        const body = handlers.onConfirm?.(JSON.parse((init?.body as string) ?? "{}")) ?? { evidenceItemId: "item-1", acceptedEvidenceType: null, acceptedAnswerCount: 0, acceptedConnectionCount: 0, rejectedCount: 0 };
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      if (url.includes("/analysis") && init?.method === "POST") {
        const result = handlers.onAnalyzePost?.();
        return Promise.resolve({ ok: true, status: 200, json: async () => (result ?? baseAnalysis()) });
      }
      if (url.includes("/analysis")) {
        const result = handlers.onGet?.() ?? null;
        if (!result) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
        return Promise.resolve({ ok: true, status: 200, json: async () => result });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

describe("AnalysisPanel", () => {
  it("shows the Analyze Evidence button and nothing else before any analysis exists", async () => {
    mockFetch({ onGet: () => null });
    render(<AnalysisPanel evidenceItemId="item-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyze Evidence" })).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the summary line after analysis completes", async () => {
    mockFetch({
      onGet: () => null,
      onAnalyzePost: () => baseAnalysis({ summary: { answerCount: 2, dateCount: 3, identifierCount: 1, connectionCount: 1 } }),
    });
    render(<AnalysisPanel evidenceItemId="item-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyze Evidence" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Analyze Evidence" }));
    await waitFor(() => expect(screen.getByText(/Analysis ready: 2 answers, 3 dates, 1 identifier, and 1 connection suggested\./)).toBeTruthy());
  });

  it("shows evidence-type candidates with confidence and rationale, and lets the user select one via radio button — nothing is pre-selected", async () => {
    mockFetch({
      onGet: () => null,
      onAnalyzePost: () =>
        baseAnalysis({
          evidenceTypeSuggestions: [
            { id: 10, analysisRunId: 1, fieldKind: "evidence_type", fieldId: null, proposedValue: "customer_order", normalizedValue: "customer_order", confidence: "high", rationale: "Order number found", supportingSignals: [], sourceLocations: [], generationMethod: "deterministic", state: "proposed", userCorrection: null, createdAt: "x", confirmedAt: null },
          ],
        }),
    });
    render(<AnalysisPanel evidenceItemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze Evidence" }));
    await waitFor(() => expect(screen.getByText("Customer Order")).toBeTruthy());
    expect(screen.getByText("Order number found")).toBeTruthy();
    const radio = screen.getByRole("radio") as HTMLInputElement;
    expect(radio.checked).toBe(false);
  });

  it("does not enable Save until at least one decision has been made, and never sends anything without an explicit accept", async () => {
    mockFetch({
      onGet: () => null,
      onAnalyzePost: () =>
        baseAnalysis({
          answerSuggestions: [
            { id: 20, analysisRunId: 1, fieldKind: "question_answer", fieldId: "customer_photo_relationship", proposedValue: "", normalizedValue: null, confidence: "low", rationale: "Never guessed", supportingSignals: [], sourceLocations: [], generationMethod: "deterministic", state: "unresolved", userCorrection: null, createdAt: "x", confirmedAt: null },
          ],
        }),
    });
    render(<AnalysisPanel evidenceItemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze Evidence" }));
    await waitFor(() => expect(screen.getByText("customer_photo_relationship")).toBeTruthy());
    const saveButton = screen.getByRole("button", { name: "Save Accepted Suggestions" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("only sends explicitly accepted answers to confirm, and reports accepted counts back", async () => {
    let confirmedBody: unknown = null;
    mockFetch({
      onGet: () => null,
      onAnalyzePost: () =>
        baseAnalysis({
          answerSuggestions: [
            { id: 30, analysisRunId: 1, fieldKind: "question_answer", fieldId: "some_question", proposedValue: "Yes", normalizedValue: "Yes", confidence: "high", rationale: "Found in text", supportingSignals: [], sourceLocations: ["OCR text"], generationMethod: "deterministic", state: "proposed", userCorrection: null, createdAt: "x", confirmedAt: null },
          ],
        }),
      onConfirm: (body) => {
        confirmedBody = body;
        return { evidenceItemId: "item-1", acceptedEvidenceType: null, acceptedAnswerCount: 1, acceptedConnectionCount: 0, rejectedCount: 0 };
      },
    });
    render(<AnalysisPanel evidenceItemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze Evidence" }));
    await waitFor(() => expect(screen.getByText("some_question")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Accepted Suggestions" }));

    await waitFor(() => expect(screen.getByText(/Saved: 1 answer, 0 connections accepted\./)).toBeTruthy());
    expect(confirmedBody).toMatchObject({ acceptedAnswers: [{ suggestionId: 30, value: "Yes" }] });
  });

  it("shows a stale badge and disables selection for a stale run", async () => {
    mockFetch({
      onGet: () =>
        baseAnalysis({
          run: { id: 1, evidenceItemId: "item-1", sourceFingerprint: "old-sha", metadataVersion: "1", evidenceTypeRegistryVersion: "1.0", questionRegistryVersion: "1.0", deterministicRuleVersion: "1", status: "completed", initiatedAt: "x", completedAt: "x", providerId: null, providerModel: null, providerVersion: null, errorMessage: null, stale: true },
          evidenceTypeSuggestions: [
            { id: 40, analysisRunId: 1, fieldKind: "evidence_type", fieldId: null, proposedValue: "product_photo", normalizedValue: "product_photo", confidence: "medium", rationale: "x", supportingSignals: [], sourceLocations: [], generationMethod: "deterministic", state: "stale", userCorrection: null, createdAt: "x", confirmedAt: null },
          ],
        }),
    });
    render(<AnalysisPanel evidenceItemId="item-1" />);
    await waitFor(() => expect(screen.getByText("Stale — re-analyze")).toBeTruthy());
    const radio = screen.getByRole("radio") as HTMLInputElement;
    expect(radio.disabled).toBe(true);
  });
});
