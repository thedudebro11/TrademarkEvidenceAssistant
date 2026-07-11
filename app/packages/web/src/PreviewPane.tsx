import { useState } from "react";
import { getPreviewKind, type EvidenceItemDetail } from "@trademark-evidence-assistant/shared";
import { evidenceItemFileUrl } from "./api.js";

interface PreviewPaneProps {
  item: EvidenceItemDetail;
}

/**
 * Presentation only — decides how to render a preview using the shared
 * getPreviewKind classifier, and implements the required UI states from
 * spec 11: missing original, unsupported preview, corrupt file.
 */
export function PreviewPane({ item }: PreviewPaneProps) {
  const [loadFailed, setLoadFailed] = useState(false);

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

  if (loadFailed) {
    return (
      <div role="alert" aria-label="Preview">
        <p>This file could not be opened for preview. It may be corrupted.</p>
      </div>
    );
  }

  if (kind === "unsupported") {
    return (
      <div role="status" aria-label="Preview">
        <p>
          Preview is not available for .{item.extension} files. The file is
          still part of your evidence set — it just can't be shown inline.
        </p>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <img
        src={fileUrl}
        alt={item.originalFilename}
        onError={() => setLoadFailed(true)}
        style={{ maxWidth: "100%", maxHeight: "100%" }}
      />
    );
  }

  if (kind === "video") {
    // eslint-disable-next-line jsx-a11y/media-has-caption -- source evidence has no captions to provide
    return <video src={fileUrl} controls onError={() => setLoadFailed(true)} style={{ maxWidth: "100%" }} />;
  }

  // pdf and text both render fine in an iframe via the browser's native viewer.
  return <iframe src={fileUrl} title={item.originalFilename} onError={() => setLoadFailed(true)} />;
}
