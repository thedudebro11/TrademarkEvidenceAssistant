import { z } from "zod";

/**
 * Shape of the repo-root `workspace.config.json`. Kept minimal for
 * Phase 1: it names the single active workspace (Phase 0 decision 7 —
 * no workspace switcher in v1, but the schema stays workspace-aware).
 */
export const WorkspaceConfigSchema = z.object({
  activeWorkspace: z.string().min(1),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
