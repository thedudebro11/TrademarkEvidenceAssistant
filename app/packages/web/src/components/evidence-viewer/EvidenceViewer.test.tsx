import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EvidenceViewer } from "./EvidenceViewer.js";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const baseItem: EvidenceItemDetail = {
  id: "item-1",
  originalPath: "product_photo.jpg",
  originalFilename: "product_photo.jpg",
  extension: "jpg",
  mimeType: "image/jpeg",
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

describe("EvidenceViewer — dispatch (the Review page only ever talks to this component)", () => {
  it("dispatches a jpg to an <img> (ImageViewer)", () => {
    render(<EvidenceViewer item={baseItem} />);
    expect(screen.getByAltText("product_photo.jpg")).toBeTruthy();
    expect(screen.getByAltText("product_photo.jpg").tagName).toBe("IMG");
  });

  it("dispatches an svg to an <img> too, via the separate SvgViewer branch", () => {
    const svgItem: EvidenceItemDetail = { ...baseItem, extension: "svg", originalFilename: "logo.svg" };
    render(<EvidenceViewer item={svgItem} />);
    expect(screen.getByAltText("logo.svg").tagName).toBe("IMG");
  });

  it("dispatches a video extension to a <video> element with controls, no autoplay", () => {
    const videoItem: EvidenceItemDetail = { ...baseItem, extension: "mp4", originalFilename: "clip.mp4" };
    const { container } = render(<EvidenceViewer item={videoItem} />);
    const video = container.querySelector("video")!;
    expect(video).toBeTruthy();
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(false);
  });

  it("dispatches a container format like mkv to VideoViewer too — never rejected as unsupported by extension alone", () => {
    const mkvItem: EvidenceItemDetail = { ...baseItem, extension: "mkv", originalFilename: "clip.mkv" };
    const { container } = render(<EvidenceViewer item={mkvItem} />);
    expect(container.querySelector("video")).toBeTruthy();
    expect(screen.queryByText(/not available for \.mkv/)).toBeNull();
  });

  it("dispatches a pdf to an iframe", () => {
    const pdfItem: EvidenceItemDetail = { ...baseItem, extension: "pdf", originalFilename: "invoice.pdf" };
    const { container } = render(<EvidenceViewer item={pdfItem} />);
    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("dispatches a heic extension to HeicViewer, not ImageViewer or UnsupportedViewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "ready", previewMimeType: "image/jpeg", previewGeneratedAt: "2026-01-01T00:00:00.000Z", previewGenerator: "libheif-js", previewGeneratorVersion: "1.19.8", decoderSelection: "auto", conversionError: null }),
      }),
    );
    const heicItem: EvidenceItemDetail = {
      ...baseItem,
      extension: "heic",
      originalFilename: "IMG_20260717_020251.heic",
      heicPreview: { status: "ready", previewMimeType: "image/jpeg", previewGeneratedAt: "2026-01-01T00:00:00.000Z", previewGenerator: "libheif-js", previewGeneratorVersion: "1.19.8", decoderSelection: "auto", conversionError: null },
    };
    render(<EvidenceViewer item={heicItem} />);
    await waitFor(() => expect(screen.getByAltText("IMG_20260717_020251.heic")).toBeTruthy());
    expect(screen.queryByText(/Preview is not available for \.heic/)).toBeNull();
    expect(screen.getByText((_, node) => node?.tagName === "SMALL" && node.textContent === "Generated preview of original HEIC — decoded with libheif-js 1.19.8.")).toBeTruthy();
  });

  it("dispatches a truly unsupported type (e.g. psd) to UnsupportedViewer with a download option", () => {
    const psdItem: EvidenceItemDetail = { ...baseItem, extension: "psd", mimeType: "image/vnd.adobe.photoshop" };
    render(<EvidenceViewer item={psdItem} />);
    expect(screen.getByText(/Preview is not available for \.psd files/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download" })).toBeTruthy();
  });

  it("shows the missing-file message once, regardless of what kind of evidence it would have been", () => {
    const missingItem: EvidenceItemDetail = { ...baseItem, missingSince: "2026-02-01T00:00:00.000Z" };
    render(<EvidenceViewer item={missingItem} />);
    expect(screen.getByText(/can no longer be found on disk/)).toBeTruthy();
  });

  it("always shows the Evidence Intelligence section with an explicit Analyze action — nothing runs automatically on render", () => {
    render(<EvidenceViewer item={baseItem} />);
    expect(screen.getByText("Evidence Intelligence")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Analyze Evidence" })).toBeTruthy();
    // No suggestion content renders until the button is actually clicked.
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("VideoViewer — graceful codec-unsupported fallback", () => {
  it("shows a friendly message and recovery actions when the browser can't decode the video, instead of marking it unsupported", () => {
    const videoItem: EvidenceItemDetail = { ...baseItem, extension: "mkv", originalFilename: "clip.mkv" };
    const { container } = render(<EvidenceViewer item={videoItem} />);
    const video = container.querySelector("video")!;

    fireEvent.error(video);

    expect(screen.getByText("This video's codec isn't supported by your browser.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open externally" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download" })).toBeTruthy();
    // The evidence itself is never called "unsupported" here.
    expect(screen.queryByText(/not available for/)).toBeNull();
  });

  it("'View metadata' calls the onViewMetadata callback the Review page provided", () => {
    const videoItem: EvidenceItemDetail = { ...baseItem, extension: "mkv", originalFilename: "clip.mkv" };
    const onViewMetadata = vi.fn();
    const { container } = render(<EvidenceViewer item={videoItem} onViewMetadata={onViewMetadata} />);
    fireEvent.error(container.querySelector("video")!);

    fireEvent.click(screen.getByRole("button", { name: "View metadata" }));
    expect(onViewMetadata).toHaveBeenCalled();
  });

  it("'Open externally' opens the file URL in a new tab without navigating the current page", () => {
    const videoItem: EvidenceItemDetail = { ...baseItem, extension: "mkv", originalFilename: "clip.mkv" };
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(<EvidenceViewer item={videoItem} />);
    fireEvent.error(container.querySelector("video")!);

    fireEvent.click(screen.getByRole("button", { name: "Open externally" }));
    expect(openSpy).toHaveBeenCalledWith("/api/evidence-items/item-1/file", "_blank", "noopener");
    openSpy.mockRestore();
  });
});
