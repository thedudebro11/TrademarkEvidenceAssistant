import { createApp } from "./app.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { ensureWorkspaceRow } from "./db/ensureWorkspaceRow.js";
import { loadWorkspaceConfig } from "./config/workspaceConfig.js";
import { REPO_ROOT } from "./config/repoRoot.js";
import { PORT } from "./config/env.js";

const workspace = loadWorkspaceConfig(REPO_ROOT);

if (!workspace.evidenceRootExists) {
  console.warn(
    `Warning: evidence root does not exist yet: ${workspace.evidenceRoot}`,
  );
}

const db = openDatabase(workspace.databasePath);
runMigrations(db);
const workspaceId = ensureWorkspaceRow(db, workspace.name, workspace.evidenceRoot);

const app = createApp(db, workspace, workspaceId);

app.listen(PORT, () => {
  console.log(`Trademark Evidence Assistant server listening on http://localhost:${PORT}`);
  console.log(`Active workspace: ${workspace.name} (evidence root: ${workspace.evidenceRoot})`);
});
