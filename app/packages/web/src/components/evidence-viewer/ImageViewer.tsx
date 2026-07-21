import { useState } from "react";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

interface ImageViewerProps {
  item: EvidenceItemDetail;
  fileUrl: string;
}

/** Raster images (jpg/jpeg/png/webp/gif). See SvgViewer for vector images, kept separate per the Evidence Viewer architecture. */
export function ImageViewer({ item, fileUrl }: ImageViewerProps) {
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
