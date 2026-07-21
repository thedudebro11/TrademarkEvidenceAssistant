import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConnectionsPanel } from "./ConnectionsPanel.js";
import type { DraftConnectionView } from "./reviewDraft.js";

afterEach(() => {
  cleanup();
});

const existingConnection: DraftConnectionView = {
  draftKey: "conn-7",
  connectionId: 7,
  direction: "outgoing",
  relatedOriginalPath: "Proof Files/invoice.pdf",
  type: "related_to",
  explanation: "Same order.",
  confidence: "medium",
  markedForRemoval: false,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ConnectionsPanel>> = {}) {
  return render(
    <ConnectionsPanel
      connections={[]}
      noRelatedEvidence={false}
      onRemove={() => {}}
      onUnmarkRemoval={() => {}}
      onToggleNoRelatedEvidence={() => {}}
      onOpenWorkspace={() => {}}
      triggerRef={createRef()}
      {...overrides}
    />,
  );
}

describe("ConnectionsPanel — existing connection behavior (unchanged)", () => {
  it("shows the empty-state message and guidance when there are no connections and nothing has been reviewed", () => {
    renderPanel();
    expect(screen.getByText("No connections have been linked yet.")).toBeTruthy();
    expect(screen.getByText(/Connections are optional/)).toBeTruthy();
    expect(screen.getByText(/Design Mockup → PSD Source/)).toBeTruthy();
    expect(screen.getByText(/These examples are informational only/)).toBeTruthy();
  });

  it("renders an existing connection and calls onRemove (not a DELETE request) when Remove is clicked", () => {
    const onRemove = vi.fn();
    renderPanel({ connections: [existingConnection], onRemove });
    expect(screen.getByText("Proof Files/invoice.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("conn-7");
  });

  it("shows a 'Pending addition' badge for a not-yet-saved connection", () => {
    const pending: DraftConnectionView = { ...existingConnection, connectionId: null, direction: "new", draftKey: "pending-0" };
    renderPanel({ connections: [pending] });
    expect(screen.getByText("Pending addition")).toBeTruthy();
  });

  it("shows a 'Pending removal' badge and a Keep button for a connection marked for removal, which calls onUnmarkRemoval", () => {
    const marked: DraftConnectionView = { ...existingConnection, markedForRemoval: true };
    const onUnmarkRemoval = vi.fn();
    renderPanel({ connections: [marked], onUnmarkRemoval });
    expect(screen.getByText("Pending removal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onUnmarkRemoval).toHaveBeenCalledWith("conn-7");
  });

  it("the connection list is unaffected by the noRelatedEvidence flag when connections already exist — the checkbox is not offered", () => {
    renderPanel({ connections: [existingConnection], noRelatedEvidence: false });
    expect(screen.queryByLabelText("No related evidence")).toBeNull();
    expect(screen.getByText("Proof Files/invoice.pdf")).toBeTruthy();
  });
});

describe("ConnectionsPanel — 'No Related Evidence' workflow", () => {
  it("checking 'No related evidence' calls onToggleNoRelatedEvidence(true)", () => {
    const onToggle = vi.fn();
    renderPanel({ onToggleNoRelatedEvidence: onToggle });
    fireEvent.click(screen.getByLabelText("No related evidence"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("when checked, replaces the empty-state guidance and the workspace trigger with a calm confirmation card, not a warning", () => {
    renderPanel({ noRelatedEvidence: true });
    expect(screen.getByText("No related evidence", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/reviewed and no meaningful supporting relationships currently exist/)).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(/Connections are optional/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Browse Evidence to Link/ })).toBeNull();
  });

  it("unchecking restores the workspace trigger", () => {
    const { rerender } = renderPanel({ noRelatedEvidence: true });
    expect(screen.queryByRole("button", { name: /Browse Evidence to Link/ })).toBeNull();

    rerender(
      <ConnectionsPanel
        connections={[]}
        noRelatedEvidence={false}
        onRemove={() => {}}
        onUnmarkRemoval={() => {}}
        onToggleNoRelatedEvidence={() => {}}
        onOpenWorkspace={() => {}}
        triggerRef={createRef()}
      />,
    );
    expect(screen.getByRole("button", { name: /Browse Evidence to Link/ })).toBeTruthy();
  });

  it("the checkbox reflects the current noRelatedEvidence value", () => {
    renderPanel({ noRelatedEvidence: true });
    expect((screen.getByLabelText("No related evidence") as HTMLInputElement).checked).toBe(true);
  });
});

describe("ConnectionsPanel — opening the Connections Workspace", () => {
  it("clicking 'Browse Evidence to Link' calls onOpenWorkspace", () => {
    const onOpenWorkspace = vi.fn();
    renderPanel({ onOpenWorkspace });
    fireEvent.click(screen.getByRole("button", { name: /Browse Evidence to Link/ }));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("attaches triggerRef to the trigger button, so focus can be returned to it after the workspace closes", () => {
    const triggerRef = createRef<HTMLButtonElement>();
    renderPanel({ triggerRef });
    expect(triggerRef.current).toBeInstanceOf(HTMLButtonElement);
    expect(triggerRef.current?.textContent).toContain("Browse Evidence to Link");
  });
});
