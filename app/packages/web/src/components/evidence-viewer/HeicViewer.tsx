import { useEffect, useRef, useState } from "react";
import type { EvidenceItemDetail, HeicPreviewInfo, HeicPreviewStatus } from "@trademark-evidence-assistant/shared";
import { fetchHeicPreviewStatus, generateHeicPreview, heicPreviewFileUrl } from "../../api.js";

interface HeicViewerProps {
  item: EvidenceItemDetail;
  fileUrl: string;
}

const POLL_INTERVAL_MS = 1200;
const MAX_POLL_ATTEMPTS = 30; // ~36s of polling before giving up and showing the last known status

const FAILURE_MESSAGES: Partial<Record<HeicPreviewStatus, string>> = {
  source_missing: "The original file for this evidence item can no longer be found on disk.",
};

const DECODER_LABELS: Record<string, string> = {
  "libheif-js": "libheif-js",
  imagemagick: "ImageMagick",
};

function decoderLabel(id: string | null): string {
  if (!id) return "unknown decoder";
  return DECODER_LABELS[id] ?? id;
}

/** The "other" decoder to offer for "Retry with Alternate Decoder" — a simple two-decoder toggle, matching `HEIC_DECODER_IDS` in shared/enums.ts. */
function alternateDecoderId(currentGenerator: string | null): string {
  return currentGenerator === "imagemagick" ? "libheif-js" : "imagemagick";
}

function unknownErrorInfo(message: string): HeicPreviewInfo {
  return { status: "failed", previewMimeType: null, previewGeneratedAt: null, previewGenerator: null, previewGeneratorVersion: null, decoderSelection: "auto", conversionError: message };
}

/**
 * HEIC/HEIF items (docs/ADR_0005_HEIC_PREVIEWS.md): the browser can't
 * render the original inline, so this drives the server-generated
 * preview through its lifecycle (auto-request generation if needed,
 * poll while generating, show the result or a Retry/Download fallback)
 * rather than the flat "preview not available" message
 * UnsupportedViewer still (correctly) shows for formats with no
 * generated-preview pipeline at all.
 *
 * The preview is never assumed correct just because generation
 * succeeded — a real evidence file once produced a structurally valid
 * but visually corrupted preview from the app's original (now
 * non-default) decoder. There is no reliable automated way to detect
 * that from the server side, so the only mitigation is putting the
 * choice in front of the user: an explicit decoder attribution line and
 * a "Retry with Alternate Decoder" action, always available whenever a
 * preview is showing or failed.
 */
export function HeicViewer({ item, fileUrl }: HeicViewerProps) {
  const [info, setInfo] = useState<HeicPreviewInfo | null>(item.heicPreview ?? null);
  const [loading, setLoading] = useState(item.heicPreview?.status !== "ready");
  const [imgFailed, setImgFailed] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setImgFailed(false);

    async function pollUntilSettled(initial: HeicPreviewInfo): Promise<HeicPreviewInfo> {
      let current = initial;
      let attempts = 0;
      while (!cancelledRef.current && current.status === "generating" && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        attempts++;
        current = await fetchHeicPreviewStatus(item.id);
      }
      return current;
    }

    async function driveToReady() {
      try {
        let current = await fetchHeicPreviewStatus(item.id);
        if (cancelledRef.current) return;
        if (current.status === "not_requested" || current.status === "queued" || current.status === "stale") {
          current = await generateHeicPreview(item.id);
        }
        current = await pollUntilSettled(current);
        if (!cancelledRef.current) {
          setInfo(current);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelledRef.current) {
          setInfo(unknownErrorInfo(err instanceof Error ? err.message : "Could not check the HEIC preview status"));
          setLoading(false);
        }
      }
    }

    if (item.heicPreview?.status === "ready") {
      setLoading(false);
      return;
    }
    setLoading(true);
    void driveToReady();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function runGenerate(options: Parameters<typeof generateHeicPreview>[1]) {
    setActionPending(true);
    setImgFailed(false);
    try {
      let current = await generateHeicPreview(item.id, options);
      let attempts = 0;
      while (!cancelledRef.current && current.status === "generating" && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        attempts++;
        current = await fetchHeicPreviewStatus(item.id);
      }
      if (!cancelledRef.current) setInfo(current);
    } catch (err) {
      if (!cancelledRef.current) setInfo(unknownErrorInfo(err instanceof Error ? err.message : "Retry failed"));
    } finally {
      if (!cancelledRef.current) setActionPending(false);
    }
  }

  const status: HeicPreviewStatus = info?.status ?? "not_requested";

  if (loading || status === "generating" || status === "queued" || status === "not_requested") {
    return (
      <div role="status" aria-label="Preview">
        <p>Generating HEIC preview…</p>
      </div>
    );
  }

  if (status === "ready" && !imgFailed) {
    return (
      <div className="heic-viewer">
        <img src={heicPreviewFileUrl(item.id)} alt={item.originalFilename} onError={() => setImgFailed(true)} style={{ maxWidth: "100%", maxHeight: "100%" }} />
        <p>
          <small>
            Generated preview of original HEIC — decoded with {decoderLabel(info?.previewGenerator ?? null)}
            {info?.previewGeneratorVersion ? ` ${info.previewGeneratorVersion}` : ""}.
          </small>
        </p>
        <p>
          <small>The original HEIC remains unchanged and is used for metadata and evidence integrity.</small>
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn--secondary" href={fileUrl} download={item.originalFilename}>
            Download Original HEIC
          </a>
          <button type="button" className="btn btn--secondary" disabled={actionPending} onClick={() => void runGenerate({ force: true })}>
            {actionPending ? "Regenerating…" : "Regenerate Preview"}
          </button>
          <button type="button" className="btn btn--secondary" disabled={actionPending} onClick={() => void runGenerate({ decoderId: alternateDecoderId(info?.previewGenerator ?? null) })}>
            {actionPending ? "Retrying…" : `Retry with ${decoderLabel(alternateDecoderId(info?.previewGenerator ?? null))}`}
          </button>
        </div>
        <p>
          <small>If this preview doesn&apos;t look right, use &quot;Retry with Alternate Decoder&quot; rather than trusting it — a preview can be structurally valid and still visually wrong.</small>
        </p>
      </div>
    );
  }

  const message = imgFailed ? "HEIC preview could not be generated." : (FAILURE_MESSAGES[status] ?? "HEIC preview could not be generated.");

  return (
    <div role="alert" aria-label="Preview">
      <p>{message}</p>
      {info?.conversionError && (
        <p>
          <small>{info.conversionError}</small>
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn--secondary" disabled={actionPending} onClick={() => void runGenerate({ force: true })}>
          {actionPending ? "Retrying…" : "Retry Preview"}
        </button>
        <button type="button" className="btn btn--secondary" disabled={actionPending} onClick={() => void runGenerate({ decoderId: alternateDecoderId(info?.previewGenerator ?? null) })}>
          {actionPending ? "Retrying…" : `Retry with ${decoderLabel(alternateDecoderId(info?.previewGenerator ?? null))}`}
        </button>
        <a className="btn btn--secondary" href={fileUrl} download={item.originalFilename}>
          Download Original
        </a>
      </div>
    </div>
  );
}
