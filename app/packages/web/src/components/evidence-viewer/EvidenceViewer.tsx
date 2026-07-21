import type { ReactNode } from "react";
import { getPreviewKind, type EvidenceItemDetail } from "@trademark-evidence-assistant/shared";
import { evidenceItemFileUrl } from "../../api.js";
import { AnalysisPanel } from "../analysis/AnalysisPanel.js";
import { ImageViewer } from "./ImageViewer.js";
import { HeicViewer } from "./HeicViewer.js";
import { SvgViewer } from "./SvgViewer.js";
import { VideoViewer } from "./VideoViewer.js";
import { PdfViewer } from "./PdfViewer.js";
import { TextViewer } from "./TextViewer.js";
import { UnsupportedViewer } from "./UnsupportedViewer.js";

interface EvidenceViewerProps {
  item: EvidenceItemDetail;
  /** Lets a sub-viewer (e.g. VideoViewer's codec-fallback "View metadata" action) ask the Review page to do something it already knows how to do — the Review page never reaches into a viewer's internals. */
  onViewMetadata?: () => void;
  /** Called after Evidence Intelligence's confirmation flow saves accepted suggestions — the Review page reloads the item and refreshes queue counts, since the server-side data actually changed. */
  onAnalysisConfirmed?: () => void;
}

/**
 * The Review page's only window into evidence content. ReviewQueue.tsx
 * renders `<EvidenceViewer item={item} />` and never needs to know
 * which specialized viewer handled it — the app thinks in terms of
 * "evidence," not "images." Every supported type plugs in here as one
 * more branch plus one more `<XyzViewer>`; nothing outside this file
 * changes when a new type is added (PSD previews, ZIP manifests, audio,
 * 3D models, browser archives — the "future" row in the architecture
 * this shipped under).
 *
 * The missing-file state is handled once here, above the per-type
 * dispatch, since it's the same message regardless of what kind of
 * evidence it would have been. Per-type failure states (corrupt image,
 * codec-unsupported video, etc.) are each sub-viewer's own concern.
 */
export function EvidenceViewer({ item, onViewMetadata, onAnalysisConfirmed }: EvidenceViewerProps) {
  if (item.missingSince) {
    return (
      <div role="status" aria-label="Preview">
        <p>
          The original file for this evidence item can no longer be found on
          disk (missing since {new Date(item.missingSince).toLocaleString()}).
          Nothing was deleted by this application — the file is simply gone
          from where it was last scanned.
        </p>
      </div>
    );
  }

  const kind = getPreviewKind(item.extension);
  const fileUrl = evidenceItemFileUrl(item.id);
  const isSvg = item.extension.toLowerCase().replace(/^\./, "") === "svg";

  let viewer: ReactNode;
  if (kind === "unsupported") {
    viewer = <UnsupportedViewer item={item} fileUrl={fileUrl} />;
  } else if (kind === "image" && isSvg) {
    viewer = <SvgViewer item={item} fileUrl={fileUrl} />;
  } else if (kind === "image") {
    viewer = <ImageViewer item={item} fileUrl={fileUrl} />;
  } else if (kind === "heic") {
    viewer = <HeicViewer item={item} fileUrl={fileUrl} />;
  } else if (kind === "video") {
    viewer = <VideoViewer item={item} fileUrl={fileUrl} onViewMetadata={onViewMetadata} />;
  } else if (kind === "pdf") {
    viewer = <PdfViewer item={item} fileUrl={fileUrl} />;
  } else {
    viewer = <TextViewer item={item} fileUrl={fileUrl} />;
  }

  return (
    <div className="evidence-viewer">
      <div className="evidence-viewer__stage">{viewer}</div>
      <AnalysisPanel evidenceItemId={item.id} onConfirmed={onAnalysisConfirmed} />
    </div>
  );
}
