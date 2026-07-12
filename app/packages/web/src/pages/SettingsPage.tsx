import { PageHeader } from "../components/layout/PageHeader.js";
import { Card } from "../components/ui/Card.js";
import { Badge } from "../components/ui/Badge.js";
import { StatusMessage } from "../components/ui/StatusMessage.js";
import { useAppState } from "../app/AppStateContext.js";

/** docs/ui/UI_INFORMATION_ARCHITECTURE.md Page 4 — Settings: kept minimal, no preference system. */
export function SettingsPage() {
  const { health, healthError } = useAppState();

  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace and evidence safety information." />
      {healthError && <StatusMessage tone="error">Backend unreachable: {healthError}</StatusMessage>}
      {health && (
        <Card title="Workspace">
          <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", rowGap: 10 }}>
            <dt>Active workspace</dt>
            <dd>{health.workspace.name}</dd>
            <dt>Evidence root</dt>
            <dd style={{ wordBreak: "break-all" }}>{health.workspace.evidenceRoot}</dd>
            <dt>Evidence root status</dt>
            <dd>
              <Badge tone={health.workspace.evidenceRootExists ? "success" : "danger"}>
                {health.workspace.evidenceRootExists ? "Found" : "Not found"}
              </Badge>
            </dd>
            <dt>Database</dt>
            <dd>
              <Badge tone={health.database.connected ? "success" : "danger"}>
                {health.database.connected ? "Connected" : "Unavailable"}
              </Badge>
            </dd>
          </dl>
        </Card>
      )}
      <Card title="Evidence safety" className="motion-fade-in">
        Original evidence files are always read-only. This application never modifies, renames, or moves an
        original file — only reads bytes for preview and hashing, and copies approved files into a separate,
        newly generated evidence package.
      </Card>
    </>
  );
}
