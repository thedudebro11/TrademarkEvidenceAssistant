import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MetadataPanel } from "./MetadataPanel.js";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

const baseItem: EvidenceItemDetail = {
  id: "item-1",
  originalPath: "Design Files/logo_edit.jpg",
  originalFilename: "logo_edit.jpg",
  extension: "jpg",
  mimeType: "image/jpeg",
  fileSize: 2048,
  sha256: "abc",
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fsCreatedAt: null,
  fsModifiedAt: "2026-01-01T00:00:00.000Z",
  missingSince: null,
  reviewStatus: "unreviewed",
  inclusionDecision: null,
  notes: null,
  notesUpdatedAt: null,
  decidedAt: null,
  metadata: { width: 60, height: 40, pageCount: null },
  duplicates: [],
  fileRole: null,
  answers: [],
  connections: [],
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
  evidenceType: null,
  evidenceTypeSuggestion: null,
  noRelatedEvidence: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("MetadataPanel — existing image/pdf behavior (unchanged)", () => {
  it("shows dimensions for an image with metadata", () => {
    render(<MetadataPanel item={baseItem} />);
    expect(screen.getByText("60 × 40")).toBeTruthy();
  });

  it("shows 'None available' for a non-video item with no metadata, and never fetches video-metadata", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("should not be called")));
    const noMetaItem: EvidenceItemDetail = { ...baseItem, metadata: null };
    render(<MetadataPanel item={noMetaItem} />);
    expect(screen.getByText("None available for this file type.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("MetadataPanel — video details (new)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ durationSeconds: null, width: null, height: null, codec: null, fps: null, bitrateKbps: null, hasAudio: null }),
      }),
    );
  });

  it("fetches video metadata for a video item and shows the 'not extracted yet' message when every field is unknown", async () => {
    const videoItem: EvidenceItemDetail = { ...baseItem, extension: "mp4", originalFilename: "clip.mp4", metadata: null };
    render(<MetadataPanel item={videoItem} />);

    expect(fetch).toHaveBeenCalledWith("/api/evidence-items/item-1/video-metadata");
    await waitFor(() => expect(screen.getByText(/aren't extracted yet/)).toBeTruthy());
    // Doesn't also show the generic "no metadata for this file type" message for videos.
    expect(screen.queryByText("None available for this file type.")).toBeNull();
  });

  it("shows real values once a (future) provider returns them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ durationSeconds: 125, width: 1920, height: 1080, codec: "h264", fps: 30, bitrateKbps: 4500, hasAudio: true }),
      }),
    );
    const videoItem: EvidenceItemDetail = { ...baseItem, extension: "mp4", originalFilename: "clip.mp4", metadata: null };
    render(<MetadataPanel item={videoItem} />);

    await waitFor(() => expect(screen.getByText("2:05")).toBeTruthy());
    expect(screen.getByText("1920 × 1080")).toBeTruthy();
    expect(screen.getByText("h264")).toBeTruthy();
    expect(screen.getByText("30 fps")).toBeTruthy();
    expect(screen.getByText("4500 kbps")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });
});

describe("MetadataPanel — HEIC details (new)", () => {
  const heicItem: EvidenceItemDetail = {
    ...baseItem,
    extension: "heic",
    originalFilename: "IMG_20260717_020251.heic",
    fsModifiedAt: "2026-07-20T00:00:00.000Z",
    metadata: {
      width: 3024,
      height: 4032,
      pageCount: null,
      exifDateTimeOriginal: "2026:07:17 02:02:51",
      exifCreateDate: null,
      gpsLatitude: 37.775,
      gpsLongitude: -122.42,
      cameraMake: "Google",
      cameraModel: "Pixel 8",
      orientation: 6,
      colorProfile: "Display P3",
      filenameInferredDate: "2026-07-17T02:02:51",
    },
  };

  it("11. prefers EXIF DateTimeOriginal for the auto-detected likely capture time", () => {
    render(<MetadataPanel item={heicItem} />);
    expect(screen.getByText(/Likely capture time \(auto-detected from EXIF DateTimeOriginal\): 2026:07:17 02:02:51/)).toBeTruthy();
  });

  it("10. shows the filename-inferred date and filesystem date as clearly separate, distinctly labeled fields", () => {
    render(<MetadataPanel item={heicItem} />);
    expect(screen.getByText("Filename-inferred date (not confirmed)")).toBeTruthy();
    expect(screen.getByText("2026-07-17T02:02:51")).toBeTruthy();
    expect(screen.getByText("Filesystem last-modified date (not proof of event date)")).toBeTruthy();
    // Computed rather than hardcoded — a literal date string here is timezone-dependent
    // (this UTC midnight timestamp formats as a different calendar date west of UTC).
    expect(screen.getByText(new Date(heicItem.fsModifiedAt!).toLocaleDateString())).toBeTruthy();
  });

  it("shows camera, orientation, color profile, and GPS as their own separate fields", () => {
    render(<MetadataPanel item={heicItem} />);
    expect(screen.getByText("Google Pixel 8")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("Display P3")).toBeTruthy();
    expect(screen.getByText("37.775000, -122.420000")).toBeTruthy();
  });

  it("falls back to filename-inference labeling when no EXIF date exists, and never claims it's confirmed", () => {
    const noExifItem: EvidenceItemDetail = {
      ...heicItem,
      metadata: { ...heicItem.metadata!, exifDateTimeOriginal: null, exifCreateDate: null },
    };
    render(<MetadataPanel item={noExifItem} />);
    expect(screen.getByText(/Likely capture time \(auto-detected from filename pattern — not confirmed\)/)).toBeTruthy();
  });
});
