import { useState } from "react";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";
import { Button } from "../ui/Button.js";

interface VideoViewerProps {
  item: EvidenceItemDetail;
  fileUrl: string;
  /** Lets the codec-unsupported fallback ask the Review page to open Details, without VideoViewer knowing anything about accordions. */
  onViewMetadata?: () => void;
}

/**
 * Native HTML5 <video> — deliberately not a custom player. The browser
 * already provides play/pause/seek/fullscreen/volume via its own
 * controls, and playback speed is reachable through the native
 * controls' context menu in every major desktop browser; a custom
 * control bar would be a much larger surface for marginal gain.
 * `preload="metadata"` and no `autoPlay` — "never autoplay" is a hard
 * requirement here, not just a default.
 *
 * A video's container extension (mp4/webm/mkv/mov/m4v/avi — see
 * previewKind.ts) doesn't guarantee the browser can decode the codec
 * inside. When playback genuinely fails, this shows a calm, actionable
 * fallback instead of pretending the evidence itself is unsupported:
 * the file is still fully part of the evidence set, it just can't play
 * inline in this particular browser.
 */
export function VideoViewer({ item, fileUrl, onViewMetadata }: VideoViewerProps) {
  const [playbackFailed, setPlaybackFailed] = useState(false);

  if (playbackFailed) {
    return (
      <div role="status" aria-label="Preview" className="evidence-viewer__video-fallback">
        <p>This video's codec isn't supported by your browser.</p>
        <p>
          <small>The file itself is still fully part of your evidence — it just can't play inline here.</small>
        </p>
        <div className="evidence-viewer__video-fallback-actions">
          <Button variant="secondary" onClick={() => window.open(fileUrl, "_blank", "noopener")}>
            Open externally
          </Button>
          <a className="btn btn--secondary" href={fileUrl} download={item.originalFilename}>
            Download
          </a>
          {onViewMetadata && (
            <Button variant="tertiary" onClick={onViewMetadata}>
              View metadata
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- source evidence has no captions to provide
    <video
      src={fileUrl}
      controls
      preload="metadata"
      onError={() => setPlaybackFailed(true)}
      style={{ maxWidth: "100%", maxHeight: "100%" }}
    />
  );
}
