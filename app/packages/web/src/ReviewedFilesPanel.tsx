import { useEffect, useState } from "react";
import type { EvidenceTreeNode, InclusionDecision, ReviewStatus } from "@trademark-evidence-assistant/shared";
import { fetchEvidenceTree } from "./api.js";
import { Badge } from "./components/ui/Badge.js";
import { decisionStatus } from "./DecisionBar.js";

interface ReviewedFilesPanelProps {
  currentItemId: string;
  onSelectItem: (itemId: string) => void;
}

interface FlatReviewedFile {
  id: string;
  name: string;
  folderPath: string;
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
}

/** Display order for the grouped sections — matches the four decision buttons' left-to-right order. */
const DECISION_ORDER = ["Included", "Marked Maybe", "Needs Follow-Up", "Archived"];

function flattenReviewedFiles(nodes: EvidenceTreeNode[], folderPath = ""): FlatReviewedFile[] {
  const result: FlatReviewedFile[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (node.reviewStatus !== "unreviewed") {
        result.push({ id: node.id, name: node.name, folderPath, reviewStatus: node.reviewStatus, inclusionDecision: node.inclusionDecision });
      }
    } else {
      result.push(...flattenReviewedFiles(node.children, folderPath ? `${folderPath} / ${node.name}` : node.name));
    }
  }
  return result;
}

function groupByDecision(files: FlatReviewedFile[]): Map<string, FlatReviewedFile[]> {
  const groups = new Map<string, FlatReviewedFile[]>();
  for (const file of files) {
    // Every file here already has reviewStatus !== "unreviewed", so
    // decisionStatus is guaranteed non-null — it only returns null for
    // the not-yet-decided case, which was filtered out above.
    const status = decisionStatus(file.reviewStatus, file.inclusionDecision);
    if (!status) continue;
    const list = groups.get(status.label) ?? [];
    list.push(file);
    groups.set(status.label, list);
  }
  return groups;
}

/**
 * A flat, decision-grouped list of every file that's been reviewed so
 * far — independent of folder structure, unlike EvidenceTreePanel.
 * Built from the same tree endpoint (fetched independently here, same
 * reasoning as EvidenceTreePanel's own fetch: read-only reference data,
 * not part of the Review Draft). Clicking a file jumps to it the same
 * way the tree does — same `onSelectItem` contract, so ReviewQueue
 * doesn't need to know which sidebar view produced the click.
 */
export function ReviewedFilesPanel({ currentItemId, onSelectItem }: ReviewedFilesPanelProps) {
  const [tree, setTree] = useState<EvidenceTreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEvidenceTree()
      .then((nodes) => {
        if (!cancelled) setTree(nodes);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p role="alert">Could not load reviewed files: {error}</p>;
  }
  if (!tree) {
    return <p role="status">Loading reviewed files…</p>;
  }

  const flat = flattenReviewedFiles(tree);
  if (flat.length === 0) {
    return <p>No files have been reviewed yet.</p>;
  }
  const groups = groupByDecision(flat);

  return (
    <div className="reviewed-files" aria-label="Reviewed files">
      {DECISION_ORDER.map((label) => {
        const items = groups.get(label) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={label} aria-label={label} className="reviewed-files__group">
            <h3>
              {label} <Badge tone="neutral">{items.length}</Badge>
            </h3>
            <ul>
              {items.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    aria-current={file.id === currentItemId ? "true" : undefined}
                    className={file.id === currentItemId ? "evidence-tree__file evidence-tree__file--current" : "evidence-tree__file"}
                    onClick={() => onSelectItem(file.id)}
                  >
                    <span className="evidence-tree__filename">{file.name}</span>
                    {file.folderPath && <small>{file.folderPath}</small>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
