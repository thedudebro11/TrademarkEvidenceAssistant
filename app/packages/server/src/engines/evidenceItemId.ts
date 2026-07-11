import { createHash } from "node:crypto";

/**
 * Derives a stable Evidence Item ID from workspace + relative path
 * (never from content hash — content is allowed to be re-read on every
 * rescan, but the *identity* of "this file at this path" must stay the
 * same across rescans so review data stays attached to it). Spec 04
 * requires "stable Evidence Item IDs"; deriving deterministically avoids
 * needing a DB round-trip to know whether an item already exists.
 */
export function deriveEvidenceItemId(workspaceId: number, relativePath: string): string {
  return createHash("sha256")
    .update(`${workspaceId}:${relativePath}`)
    .digest("hex")
    .slice(0, 32);
}
