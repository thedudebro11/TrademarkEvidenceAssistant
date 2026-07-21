import { useEffect, useState } from "react";
import { formatFilesystemDate, getPreviewKind, type EvidenceItemDetail, type VideoMetadata } from "@trademark-evidence-assistant/shared";
import { fetchVideoMetadata } from "./api.js";

interface MetadataPanelProps {
  item: EvidenceItemDetail;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Presentation only — spec 11 "no metadata" and "duplicate" states live here. */
/**
 * Auto-detected "likely capture time" for a HEIC/HEIF item, following
 * docs/ADR_0005_HEIC_PREVIEWS.md's date-preference order (user-confirmed
 * capture date is a separate review-answer question, not surfaced
 * here): EXIF DateTimeOriginal, then EXIF CreateDate, then the weak
 * filename-inferred guess. Returns the value plus a label naming its
 * actual source — this is display guidance only; every source is also
 * always shown individually below, never collapsed away.
 */
function likelyCaptureTime(metadata: EvidenceItemDetail["metadata"]): { value: string; sourceLabel: string } | null {
  if (!metadata) return null;
  if (metadata.exifDateTimeOriginal) return { value: metadata.exifDateTimeOriginal, sourceLabel: "EXIF DateTimeOriginal" };
  if (metadata.exifCreateDate) return { value: metadata.exifCreateDate, sourceLabel: "EXIF CreateDate" };
  if (metadata.filenameInferredDate) return { value: metadata.filenameInferredDate, sourceLabel: "filename pattern — not confirmed" };
  return null;
}

export function MetadataPanel({ item }: MetadataPanelProps) {
  const hasMetadata = item.metadata && (item.metadata.width || item.metadata.height || item.metadata.pageCount);
  const isVideo = getPreviewKind(item.extension) === "video";
  const isHeic = getPreviewKind(item.extension) === "heic";
  const capture = isHeic ? likelyCaptureTime(item.metadata) : null;
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);

  // Auto-fetched (not an on-demand button, unlike OCR) — the default
  // provider is instant and free, since it doesn't decode the video at
  // all. See videoMetadataProvider.ts for why a future ffmpeg-backed
  // provider is a drop-in replacement that needs no change here.
  useEffect(() => {
    if (!isVideo) {
      setVideoMetadata(null);
      return;
    }
    let cancelled = false;
    fetchVideoMetadata(item.id)
      .then((m) => {
        if (!cancelled) setVideoMetadata(m);
      })
      .catch(() => {
        if (!cancelled) setVideoMetadata(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, isVideo]);

  const videoMetadataKnown = videoMetadata && Object.values(videoMetadata).some((v) => v !== null);

  return (
    <div aria-label="Known metadata">
      <dl>
        <dt>File name</dt>
        <dd>{item.originalFilename}</dd>
        <dt>Location</dt>
        <dd>{item.originalPath}</dd>
        <dt>Size</dt>
        <dd>{formatBytes(item.fileSize)}</dd>
        {hasMetadata && item.metadata?.width && item.metadata?.height && (
          <>
            <dt>Dimensions</dt>
            <dd>
              {item.metadata.width} × {item.metadata.height}
            </dd>
          </>
        )}
        {hasMetadata && item.metadata?.pageCount && (
          <>
            <dt>Pages</dt>
            <dd>{item.metadata.pageCount}</dd>
          </>
        )}
        {!hasMetadata && !isVideo && (
          <>
            <dt>Additional metadata</dt>
            <dd>None available for this file type.</dd>
          </>
        )}
        {/* Filesystem timestamps are explicitly labeled as such per spec 04
            — they are not proof of the real-world event date. */}
        {item.fsModifiedAt && (
          <>
            <dt>Filesystem last-modified date (not proof of event date)</dt>
            <dd>{formatFilesystemDate(item.fsModifiedAt)}</dd>
          </>
        )}
      </dl>

      {isVideo && (
        <div aria-label="Video details">
          <h4>Video details</h4>
          {!videoMetadata && (
            <p role="status">
              <small>Loading video details…</small>
            </p>
          )}
          {videoMetadata && !videoMetadataKnown && (
            <p>
              <small>
                Duration, resolution, codec, and other video details aren't extracted yet — this is a reserved
                capability, not a bug.
              </small>
            </p>
          )}
          {videoMetadata && videoMetadataKnown && (
            <dl>
              {videoMetadata.durationSeconds !== null && (
                <>
                  <dt>Duration</dt>
                  <dd>{formatDuration(videoMetadata.durationSeconds)}</dd>
                </>
              )}
              {videoMetadata.width !== null && videoMetadata.height !== null && (
                <>
                  <dt>Resolution</dt>
                  <dd>
                    {videoMetadata.width} × {videoMetadata.height}
                  </dd>
                </>
              )}
              {videoMetadata.codec !== null && (
                <>
                  <dt>Codec</dt>
                  <dd>{videoMetadata.codec}</dd>
                </>
              )}
              {videoMetadata.fps !== null && (
                <>
                  <dt>Frame rate</dt>
                  <dd>{videoMetadata.fps} fps</dd>
                </>
              )}
              {videoMetadata.bitrateKbps !== null && (
                <>
                  <dt>Bitrate</dt>
                  <dd>{videoMetadata.bitrateKbps} kbps</dd>
                </>
              )}
              {videoMetadata.hasAudio !== null && (
                <>
                  <dt>Audio</dt>
                  <dd>{videoMetadata.hasAudio ? "Yes" : "No"}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}

      {isHeic && item.metadata && (
        <div aria-label="HEIC details">
          <h4>HEIC details</h4>
          {capture && (
            <p>
              <small>
                Likely capture time (auto-detected from {capture.sourceLabel}): {capture.value}
              </small>
            </p>
          )}
          {!capture && (
            <p>
              <small>No EXIF or filename-derived capture time could be determined for this file.</small>
            </p>
          )}
          <dl>
            {item.metadata.exifDateTimeOriginal && (
              <>
                <dt>EXIF DateTimeOriginal</dt>
                <dd>{item.metadata.exifDateTimeOriginal}</dd>
              </>
            )}
            {item.metadata.exifCreateDate && (
              <>
                <dt>EXIF CreateDate</dt>
                <dd>{item.metadata.exifCreateDate}</dd>
              </>
            )}
            {item.metadata.filenameInferredDate && (
              <>
                <dt>Filename-inferred date (not confirmed)</dt>
                <dd>{item.metadata.filenameInferredDate}</dd>
              </>
            )}
            {(item.metadata.cameraMake || item.metadata.cameraModel) && (
              <>
                <dt>Camera</dt>
                <dd>{[item.metadata.cameraMake, item.metadata.cameraModel].filter(Boolean).join(" ")}</dd>
              </>
            )}
            {item.metadata.orientation !== null && item.metadata.orientation !== undefined && (
              <>
                <dt>Orientation (EXIF)</dt>
                <dd>{item.metadata.orientation}</dd>
              </>
            )}
            {item.metadata.colorProfile && (
              <>
                <dt>Color profile</dt>
                <dd>{item.metadata.colorProfile}</dd>
              </>
            )}
            {item.metadata.gpsLatitude !== null && item.metadata.gpsLatitude !== undefined && item.metadata.gpsLongitude !== null && item.metadata.gpsLongitude !== undefined && (
              <>
                <dt>GPS coordinates</dt>
                <dd>
                  {item.metadata.gpsLatitude.toFixed(6)}, {item.metadata.gpsLongitude.toFixed(6)}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {item.duplicates.length > 0 && (
        <div role="status" aria-label="Duplicate notice">
          <p>
            This file is an exact byte-for-byte match of{" "}
            {item.duplicates.length === 1 ? "another file" : `${item.duplicates.length} other files`}{" "}
            already in your evidence:
          </p>
          <ul>
            {item.duplicates.map((d) => (
              <li key={d.evidenceItemId}>{d.originalPath}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
