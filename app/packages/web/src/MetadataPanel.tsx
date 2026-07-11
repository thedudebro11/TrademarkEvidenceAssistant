import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

interface MetadataPanelProps {
  item: EvidenceItemDetail;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Presentation only — spec 11 "no metadata" and "duplicate" states live here. */
export function MetadataPanel({ item }: MetadataPanelProps) {
  const hasMetadata = item.metadata && (item.metadata.width || item.metadata.height || item.metadata.pageCount);

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
        {!hasMetadata && (
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
            <dd>{new Date(item.fsModifiedAt).toLocaleDateString()}</dd>
          </>
        )}
      </dl>

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
