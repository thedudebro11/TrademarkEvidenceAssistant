import type { Ref } from "react";
import { Badge } from "./components/ui/Badge.js";
import { Button } from "./components/ui/Button.js";
import { StatusMessage } from "./components/ui/StatusMessage.js";
import { LinkIcon } from "./components/ui/icons.js";
import type { DraftConnectionView } from "./reviewDraft.js";

const EXAMPLE_CHAINS = [
  "Design Mockup → PSD Source",
  "PSD Source → Final Logo",
  "Final Logo → Product Mockup",
  "Product Photo → Instagram Post",
  "Invoice → Shipment",
  "Shipment → Customer Order",
];

interface ConnectionsPanelProps {
  connections: DraftConnectionView[];
  /** "No Related Evidence" workflow — an intentional review outcome, distinct from never having opened this section. */
  noRelatedEvidence: boolean;
  onRemove: (draftKey: string) => void;
  onUnmarkRemoval: (draftKey: string) => void;
  onToggleNoRelatedEvidence: (value: boolean) => void;
  /** Opens the large Connections Workspace drawer for browsing/selecting candidates — see components/connections/ConnectionsWorkspace.tsx. */
  onOpenWorkspace: () => void;
  /** Attached to the trigger button so ConnectionsWorkspace can return focus here on close. */
  triggerRef: Ref<HTMLButtonElement>;
}

/**
 * The compact "Connect" accordion panel: shows the current connection
 * list and the "No Related Evidence" workflow (both unchanged since the
 * Connections Workspace redesign — that redesign only replaced the
 * candidate *browser*, which is now a separate large drawer opened from
 * this panel's "Browse Evidence to Link" button, not an inline strip
 * confined to the accordion's width).
 *
 * The connection list (and the "no related evidence" intent) are fully
 * controlled by the parent Review Draft — every value here survives
 * this panel unmounting on accordion collapse.
 *
 * "No related evidence" is never a fake connection row — it's review
 * metadata only (`noRelatedEvidence` on the draft/payload), and the
 * checkbox is only offered while there are zero connections; the
 * moment one exists (added here or already persisted), that state
 * always wins and the checkbox disappears — the two states can't
 * coexist by construction, not just by convention.
 */
export function ConnectionsPanel({
  connections,
  noRelatedEvidence,
  onRemove,
  onUnmarkRemoval,
  onToggleNoRelatedEvidence,
  onOpenWorkspace,
  triggerRef,
}: ConnectionsPanelProps) {
  const hasConnections = connections.length > 0;

  return (
    <div aria-label="Evidence connections">
      {hasConnections && (
        <ul>
          {connections.map((c) => (
            <li key={c.draftKey}>
              <span>{c.direction === "outgoing" || c.direction === "new" ? "Supports →" : "← Supported by"}</span>{" "}
              <span>{c.relatedOriginalPath}</span> <span>({c.type.replace(/_/g, " ")})</span>
              <p>{c.explanation}</p>
              {c.markedForRemoval && <Badge tone="warning">Pending removal</Badge>}
              {c.connectionId === null && <Badge tone="info">Pending addition</Badge>}
              {c.markedForRemoval ? (
                <button onClick={() => onUnmarkRemoval(c.draftKey)}>Keep</button>
              ) : (
                <button onClick={() => onRemove(c.draftKey)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!hasConnections && !noRelatedEvidence && (
        <div className="connections-empty-state">
          <p>No connections have been linked yet.</p>
          <p>
            Connections are optional.
            <br />
            Only create one when another file genuinely supports, references, or is part of the same evidence chain.
          </p>
          <ul className="connections-examples">
            {EXAMPLE_CHAINS.map((chain) => (
              <li key={chain}>
                <small>{chain}</small>
              </li>
            ))}
          </ul>
          <p>
            <small>These examples are informational only.</small>
          </p>
        </div>
      )}

      {!hasConnections && noRelatedEvidence && (
        <StatusMessage tone="success">
          <strong>No related evidence</strong> — This evidence item was reviewed and no meaningful supporting
          relationships currently exist.
        </StatusMessage>
      )}

      {!hasConnections && (
        <label>
          <input
            type="checkbox"
            checked={noRelatedEvidence}
            onChange={(e) => onToggleNoRelatedEvidence(e.target.checked)}
          />
          No related evidence
        </label>
      )}

      {!noRelatedEvidence && (
        <Button ref={triggerRef} variant="secondary" icon={<LinkIcon size={16} />} onClick={onOpenWorkspace}>
          Browse Evidence to Link
        </Button>
      )}
    </div>
  );
}
