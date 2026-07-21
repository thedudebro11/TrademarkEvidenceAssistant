import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HeicViewer } from "./HeicViewer.js";
import type { EvidenceItemDetail, HeicPreviewInfo } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const baseItem: EvidenceItemDetail = {
  id: "item-1",
  originalPath: "IMG_20260717_020251.heic",
  originalFilename: "IMG_20260717_020251.heic",
  extension: "heic",
  mimeType: "image/heic",
  fileSize: 912,
  sha256: "abc123",
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fsCreatedAt: null,
  fsModifiedAt: null,
  missingSince: null,
  reviewStatus: "unreviewed",
  inclusionDecision: null,
  notes: null,
  notesUpdatedAt: null,
  decidedAt: null,
  metadata: null,
  duplicates: [],
  fileRole: null,
  answers: [],
  connections: [],
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
  evidenceType: null,
  evidenceTypeSuggestion: null,
  noRelatedEvidence: false,
};

const emptyInfo: HeicPreviewInfo = { status: "not_requested", previewMimeType: null, previewGeneratedAt: null, previewGenerator: null, previewGeneratorVersion: null, decoderSelection: "auto", conversionError: null };

function readyInfo(overrides: Partial<HeicPreviewInfo> = {}): HeicPreviewInfo {
  return { status: "ready", previewMimeType: "image/jpeg", previewGeneratedAt: "2026-01-01T00:00:00.000Z", previewGenerator: "libheif-js", previewGeneratorVersion: "1.19.8", decoderSelection: "auto", conversionError: null, ...overrides };
}

/** `textContent` matches on both the `<small>` and its parent `<p>` since the `<small>` is the sole child — scope the match to the `<small>` itself to avoid a "found multiple elements" error. */
function attributionText(expected: string) {
  return (_: string, node: Element | null) => node?.tagName === "SMALL" && node.textContent === expected;
}

function mockSequence(responses: Record<string, () => unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      for (const [pattern, handler] of Object.entries(responses)) {
        if (url.includes(pattern)) return Promise.resolve({ ok: true, status: 200, json: async () => handler() });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

describe("HeicViewer", () => {
  it("6/25. shows 'Generating HEIC preview…' while the server is converting, then renders the image once ready", async () => {
    let statusCallCount = 0;
    mockSequence({
      "/heic-preview/status": () => {
        statusCallCount++;
        return statusCallCount < 2 ? { ...emptyInfo, status: "generating" } : readyInfo();
      },
      "/heic-preview/generate": () => ({ ...emptyInfo, status: "generating" }),
    });
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: emptyInfo };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);

    expect(screen.getByText("Generating HEIC preview…")).toBeTruthy();
    await waitFor(() => expect(screen.getByAltText("IMG_20260717_020251.heic")).toBeTruthy(), { timeout: 5000 });
  });

  it("skips generation entirely and renders immediately when the item already carries a ready preview", async () => {
    mockSequence({});
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: readyInfo() };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);
    expect(screen.getByAltText("IMG_20260717_020251.heic")).toBeTruthy();
  });

  it("attributes the ready preview to the decoder and version that produced it", async () => {
    mockSequence({});
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: readyInfo({ previewGenerator: "libheif-js", previewGeneratorVersion: "1.19.8" }) };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);
    expect(screen.getByText(attributionText("Generated preview of original HEIC — decoded with libheif-js 1.19.8."))).toBeTruthy();
  });

  it("offers Regenerate Preview and Retry with Alternate Decoder alongside a ready preview, never assuming it's visually correct", async () => {
    mockSequence({});
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: readyInfo({ previewGenerator: "libheif-js" }) };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);
    expect(screen.getByRole("button", { name: "Regenerate Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry with ImageMagick" })).toBeTruthy();
  });

  it("Retry with Alternate Decoder sends the alternate decoder id and re-renders with its result", async () => {
    let lastBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/heic-preview/generate")) {
          lastBody = init?.body as string;
          return Promise.resolve({ ok: true, status: 200, json: async () => readyInfo({ previewGenerator: "imagemagick", previewGeneratorVersion: "7.1.2" }) });
        }
        throw new Error(`Unmocked fetch: ${url}`);
      }),
    );
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: readyInfo({ previewGenerator: "libheif-js" }) };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry with ImageMagick" }));

    await waitFor(() => expect(screen.getByText(attributionText("Generated preview of original HEIC — decoded with ImageMagick 7.1.2."))).toBeTruthy());
    expect(JSON.parse(lastBody ?? "{}")).toEqual({ decoderId: "imagemagick" });
  });

  it("shows the failure message, reason, Retry, Retry with Alternate Decoder, and Download Original when generation fails", async () => {
    mockSequence({
      "/heic-preview/status": () => emptyInfo,
      "/heic-preview/generate": () => ({ ...emptyInfo, status: "failed", conversionError: "libheif-js could not decode this file: unexpected end of input" }),
    });
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: emptyInfo };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);

    await waitFor(() => expect(screen.getByText("HEIC preview could not be generated.")).toBeTruthy());
    expect(screen.getByText("libheif-js could not decode this file: unexpected end of input")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry with ImageMagick" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download Original" })).toBeTruthy();
  });

  it("16. Retry calls generate again and can succeed the second time", async () => {
    let generateCallCount = 0;
    const initialFailed: HeicPreviewInfo = { ...emptyInfo, status: "failed", conversionError: "transient error" };
    mockSequence({
      "/heic-preview/status": () => initialFailed,
      "/heic-preview/generate": () => {
        generateCallCount++;
        return generateCallCount === 1 ? initialFailed : readyInfo();
      },
    });
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: initialFailed };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry Preview" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry Preview" })); // 1st attempt — still fails
    await waitFor(() => expect(generateCallCount).toBe(1));

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry Preview" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry Preview" })); // 2nd attempt — succeeds
    await waitFor(() => expect(screen.getByAltText("IMG_20260717_020251.heic")).toBeTruthy());
    expect(generateCallCount).toBe(2);
  });

  it("shows the source_missing message distinctly", async () => {
    const sourceMissing: HeicPreviewInfo = { ...emptyInfo, status: "source_missing", conversionError: "The original file can no longer be found on disk" };
    mockSequence({ "/heic-preview/status": () => sourceMissing });
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: sourceMissing };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);
    await waitFor(() => expect(screen.getByText("The original file for this evidence item can no longer be found on disk.")).toBeTruthy());
  });

  it("26. the Download Original link always points at the original-file route, never the generated preview", () => {
    mockSequence({});
    const item: EvidenceItemDetail = { ...baseItem, heicPreview: readyInfo() };
    render(<HeicViewer item={item} fileUrl="/api/evidence-items/item-1/file" />);
    const link = screen.getByRole("link", { name: "Download Original HEIC" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/evidence-items/item-1/file");
    expect(link.getAttribute("download")).toBe("IMG_20260717_020251.heic");
  });
});
