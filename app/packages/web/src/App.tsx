import { useEffect, useState } from "react";
import type { HealthResponse } from "@trademark-evidence-assistant/shared";
import { fetchHealth, fetchProgress } from "./api.js";
import { ScanPanel } from "./ScanPanel.js";
import { ReviewQueue } from "./ReviewQueue.js";
import { ExportPanel } from "./ExportPanel.js";
import { BinderPanel } from "./BinderPanel.js";

type View = "home" | "review";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [hasScannedItems, setHasScannedItems] = useState(false);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function refreshHasScannedItems() {
    fetchProgress()
      .then((p) => setHasScannedItems(p.total > 0))
      .catch(() => setHasScannedItems(false));
  }

  useEffect(() => {
    // Independent of ScanPanel's own state — this covers the case where
    // evidence was scanned in an earlier session and the app is just
    // being reopened, not just "right after clicking Begin Scan".
    refreshHasScannedItems();
  }, [view]);

  if (view === "review") {
    return (
      <main>
        <h1>Trademark Evidence Assistant</h1>
        <button onClick={() => setView("home")}>Back</button>
        <ReviewQueue />
      </main>
    );
  }

  return (
    <main>
      <h1>Trademark Evidence Assistant</h1>
      <p>Review your evidence one file at a time. Nothing will modify your original files.</p>
      {error && <p role="alert">Backend unreachable: {error}</p>}
      {health && (
        <>
          <dl>
            <dt>Status</dt>
            <dd>{health.status}</dd>
            <dt>Workspace</dt>
            <dd>{health.workspace.name}</dd>
            <dt>Evidence root exists</dt>
            <dd>{String(health.workspace.evidenceRootExists)}</dd>
            <dt>Database connected</dt>
            <dd>{String(health.database.connected)}</dd>
          </dl>
          {hasScannedItems && <button onClick={() => setView("review")}>Review Evidence</button>}
          <ScanPanel
            evidenceRootExists={health.workspace.evidenceRootExists}
            onScanComplete={refreshHasScannedItems}
          />
          {hasScannedItems && <ExportPanel />}
          {hasScannedItems && <BinderPanel />}
        </>
      )}
    </main>
  );
}
