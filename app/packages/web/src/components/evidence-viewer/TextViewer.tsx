import { useState } from "react";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

interface TextViewerProps {
  item: EvidenceItemDetail;
  fileUrl: string;
}

/** Plain text formats (txt/csv/json/md) — renders fine in the browser's native viewer via iframe. Same iframe-error-detection limitation as PdfViewer. */
export function TextViewer({ item, fileUrl }: TextViewerProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed) {
    return (
      <div role="alert" aria-label="Preview">
        <p>This file could not be opened for preview. It may be corrupted.</p>
      </div>
    );
  }

  return <iframe src={fileUrl} title={item.originalFilename} onError={() => setLoadFailed(true)} />;
}
