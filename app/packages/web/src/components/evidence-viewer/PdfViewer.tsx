import { useState } from "react";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

interface PdfViewerProps {
  item: EvidenceItemDetail;
  fileUrl: string;
}

/**
 * Delegates to the browser's native PDF viewer via iframe. Known
 * limitation: a genuinely corrupt PDF typically renders the browser's
 * own error UI inside the iframe rather than firing a detectable
 * `error` event, so `loadFailed` here only catches network-level
 * failures, not PDF-content corruption. Reliable corruption detection
 * would need a PDF.js integration — a real new dependency, out of scope
 * for this pass (see the Evidence Viewer report's "remaining
 * limitations").
 */
export function PdfViewer({ item, fileUrl }: PdfViewerProps) {
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
