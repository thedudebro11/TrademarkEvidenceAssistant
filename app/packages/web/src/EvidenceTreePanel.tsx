import { useEffect, useState } from "react";
import type { EvidenceTreeNode } from "@trademark-evidence-assistant/shared";
import { fetchEvidenceTree } from "./api.js";
import { Badge } from "./components/ui/Badge.js";
import { decisionStatus } from "./DecisionBar.js";
import { ChevronRightIcon, ChevronDownIcon } from "./components/ui/icons.js";

interface EvidenceTreePanelProps {
  currentItemId: string;
  onSelectItem: (itemId: string) => void;
}

/**
 * A folder-tree view of the whole evidence set, for jumping straight to
 * a specific file instead of only moving through the queue in order.
 * Fetched once per mount (the tree only changes after a rescan, which
 * reloads the page) — read-only reference data, not part of the Review
 * Draft, same reasoning as ConnectionsWorkspace's candidate fetch.
 *
 * Status icons reuse DecisionBar's own `decisionStatus` so the tree can
 * never show a different meaning for "Archived" than the decision dock
 * does — one definition, per docs/ARCHITECTURE_CONSTITUTION.md #2.
 */
export function EvidenceTreePanel({ currentItemId, onSelectItem }: EvidenceTreePanelProps) {
  const [tree, setTree] = useState<EvidenceTreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchEvidenceTree()
      .then((nodes) => {
        if (cancelled) return;
        setTree(nodes);
        // Expand every folder on the path down to the current item, so
        // opening the tree always shows where you already are.
        setExpanded(new Set(foldersContainingItem(nodes, currentItemId) ?? []));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Intentionally only on mount — re-fetching on every item change
    // would re-collapse folders the user opened themselves. The
    // "expand path to current item" effect below handles staying
    // visible as you navigate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tree) return;
    setExpanded((prev) => {
      const needed = foldersContainingItem(tree, currentItemId) ?? [];
      if (needed.every((p) => prev.has(p))) return prev;
      return new Set([...prev, ...needed]);
    });
  }, [tree, currentItemId]);

  function toggleFolder(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (error) {
    return <p role="alert">Could not load the evidence tree: {error}</p>;
  }
  if (!tree) {
    return <p role="status">Loading evidence tree…</p>;
  }

  return (
    <nav aria-label="Evidence files" className="evidence-tree">
      <TreeLevel
        nodes={tree}
        parentPath=""
        expanded={expanded}
        onToggleFolder={toggleFolder}
        currentItemId={currentItemId}
        onSelectItem={onSelectItem}
      />
    </nav>
  );
}

/** Folder paths (root to leaf) that must be open to reveal `itemId`, or null if it isn't in this subtree. */
function foldersContainingItem(nodes: EvidenceTreeNode[], itemId: string, parentPath = ""): string[] | null {
  for (const node of nodes) {
    if (node.type === "file") {
      if (node.id === itemId) return [];
      continue;
    }
    const path = `${parentPath}/${node.name}`;
    const found = foldersContainingItem(node.children, itemId, path);
    if (found !== null) {
      return [path, ...found];
    }
  }
  return null;
}

interface TreeLevelProps {
  nodes: EvidenceTreeNode[];
  parentPath: string;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  currentItemId: string;
  onSelectItem: (itemId: string) => void;
}

function TreeLevel({ nodes, parentPath, expanded, onToggleFolder, currentItemId, onSelectItem }: TreeLevelProps) {
  return (
    <ul>
      {nodes.map((node) => {
        if (node.type === "file") {
          const status = decisionStatus(node.reviewStatus, node.inclusionDecision);
          const isCurrent = node.id === currentItemId;
          return (
            <li key={node.id}>
              <button
                type="button"
                aria-current={isCurrent ? "true" : undefined}
                className={isCurrent ? "evidence-tree__file evidence-tree__file--current" : "evidence-tree__file"}
                onClick={() => onSelectItem(node.id)}
              >
                <span className="evidence-tree__filename">{node.name}</span>
                {status ? <Badge tone="success">{status.label}</Badge> : <Badge tone="neutral">Not reviewed</Badge>}
              </button>
            </li>
          );
        }

        const path = `${parentPath}/${node.name}`;
        const isOpen = expanded.has(path);
        return (
          <li key={path}>
            <button type="button" className="evidence-tree__folder" aria-expanded={isOpen} onClick={() => onToggleFolder(path)}>
              {isOpen ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
              {node.name}
            </button>
            {isOpen && (
              <TreeLevel
                nodes={node.children}
                parentPath={path}
                expanded={expanded}
                onToggleFolder={onToggleFolder}
                currentItemId={currentItemId}
                onSelectItem={onSelectItem}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
