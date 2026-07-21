import { useState } from "react";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

interface SvgViewerProps {
  item: EvidenceItemDetail;
  fileUrl: string;
}

/**
 * Renders identically to ImageViewer today — an <img> handles SVG fine.
 * Kept as its own component per the Evidence Viewer architecture, so a
 * future interactive/zoomable/inspectable SVG viewer only ever needs to
 * change this one file; EvidenceViewer's dispatch logic and every other
 * viewer stay untouched.
 */
export function SvgViewer({ item, fileUrl }: SvgViewerProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed) {
    return (
      <div role="alert" aria-label="Preview">
        <p>This file could not be opened for preview. It may be corrupted.</p>
      </div>
    );
  }

  return (
    <img
      src={fileUrl}
      alt={item.originalFilename}
      onError={() => setLoadFailed(true)}
      style={{ maxWidth: "100%", maxHeight: "100%" }}
    />
  );
}
