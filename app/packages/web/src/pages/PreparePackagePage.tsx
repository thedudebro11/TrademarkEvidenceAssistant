import { PageHeader } from "../components/layout/PageHeader.js";
import { Card } from "../components/ui/Card.js";
import { ExportPanel } from "../ExportPanel.js";
import { BinderPanel } from "../BinderPanel.js";

/**
 * docs/ui/UI_INFORMATION_ARCHITECTURE.md Page 3 — Prepare Package.
 * Combines Phase 7's ExportPanel and Phase 8's BinderPanel into one
 * guided two-step sequence. No new export/binder business logic — both
 * panels are the same components, restyled.
 */
export function PreparePackagePage() {
  return (
    <>
      <PageHeader
        title="Prepare Package"
        subtitle="Copy your included evidence and generate a factual summary of it."
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
        <Card eyebrow="Step 1" title="Generate Evidence Package">
          <ExportPanel />
        </Card>
        <Card eyebrow="Step 2" title="Generate Evidence Binder">
          <BinderPanel />
        </Card>
      </div>
    </>
  );
}
