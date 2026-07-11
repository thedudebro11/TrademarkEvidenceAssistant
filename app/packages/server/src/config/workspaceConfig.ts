import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceConfigSchema } from "@trademark-evidence-assistant/shared";
import { REPO_ROOT } from "./repoRoot.js";

export interface ResolvedWorkspace {
  name: string;
  evidenceRoot: string;
  evidenceRootExists: boolean;
  databasePath: string;
}

/**
 * Loads `workspace.config.json` from the repo root, validates it, and
 * resolves the active workspace's evidence directory and database file
 * path. No workspace switcher exists in v1 (Phase 0 decision 7) — this
 * always resolves a single active workspace, but nothing here hardcodes
 * "Fatletic" as logic; the name is data from config.
 */
export function loadWorkspaceConfig(
  repoRoot: string = REPO_ROOT,
): ResolvedWorkspace {
  const configPath = join(repoRoot, "workspace.config.json");
  if (!existsSync(configPath)) {
    throw new Error(`workspace.config.json not found at ${configPath}`);
  }

  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  const parsed = WorkspaceConfigSchema.parse(raw);

  const evidenceRoot = join(
    repoRoot,
    "workspaces",
    parsed.activeWorkspace,
    "evidence",
  );
  const databasePath = join(
    repoRoot,
    "generated",
    parsed.activeWorkspace,
    "app.db",
  );

  return {
    name: parsed.activeWorkspace,
    evidenceRoot,
    evidenceRootExists: existsSync(evidenceRoot),
    databasePath,
  };
}
