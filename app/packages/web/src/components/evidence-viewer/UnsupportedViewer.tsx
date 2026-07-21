import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

interface UnsupportedViewerProps {
  item: EvidenceItemDetail;
  fileUrl: string;
}

/** The true fallback — no viewer exists yet for this file type at all (e.g. PSD/XCF/AI today). Distinct from VideoViewer's codec-unsupported fallback, which is a *supported* type that just can't play in this browser. */
export function UnsupportedViewer({ item, fileUrl }: UnsupportedViewerProps) {
  return (
    <div role="status" aria-label="Preview">
      <p>
        Preview is not available for .{item.extension} files. The file is
        still part of your evidence set — it just can't be shown inline.
      </p>
      <a className="btn btn--secondary" href={fileUrl} download={item.originalFilename}>
        Download
      </a>
    </div>
  );
}
