import { statSync } from "node:fs";

/**
 * Classifies why a recorded evidence path can't be confirmed present,
 * for "Remove Missing Records" (only a `missing` classification is ever
 * eligible for deletion — everything else is uncertain and must be left
 * alone). This is deliberately a richer check than scanService.ts's own
 * missing-detection (which only asks "was this path in the last full
 * directory walk") — an ENOENT from `fs.statSync` on a Windows machine
 * accessed from WSL can mean the file was genuinely deleted, or that a
 * removable/network drive is simply disconnected right now, and those
 * two cases must never be treated the same way before a permanent
 * database deletion.
 */
export type FileAvailabilityStatus = "available" | "missing" | "permission_denied" | "drive_unavailable" | "invalid_path" | "path_temporarily_unavailable";

export interface FileAvailabilityResult {
  status: FileAvailabilityStatus;
  /** `null` only for "available". */
  reasonCode: "MISSING_FILE" | "PERMISSION_DENIED" | "DRIVE_UNAVAILABLE" | "INVALID_PATH" | "PATH_TEMPORARILY_UNAVAILABLE" | null;
}

const AVAILABLE: FileAvailabilityResult = { status: "available", reasonCode: null };

/**
 * `absolutePath` must already be resolved via `resolveSafePath` — this
 * function does no path-traversal validation of its own.
 *
 * The evidence root itself is checked first: if the workspace's own
 * evidence root can't currently be stat'd, no individual "not found"
 * result under it can be trusted (a disconnected removable/network
 * drive looks identical to a deleted file at the Node `fs` layer), so
 * every path under an unreachable root is reported `drive_unavailable`
 * rather than `missing`, regardless of that path's own error code.
 */
export function classifyFileAvailability(evidenceRoot: string, absolutePath: string): FileAvailabilityResult {
  if (!isReachable(evidenceRoot)) {
    return { status: "drive_unavailable", reasonCode: "DRIVE_UNAVAILABLE" };
  }

  try {
    statSync(absolutePath);
    return AVAILABLE;
  } catch (err) {
    return classifyStatError(err);
  }
}

function isReachable(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function classifyStatError(err: unknown): FileAvailabilityResult {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : null;

  switch (code) {
    // The path (or a directory component of it) genuinely does not
    // exist — the confident "this file was deleted" case.
    case "ENOENT":
    case "ENOTDIR":
      return { status: "missing", reasonCode: "MISSING_FILE" };
    case "EACCES":
    case "EPERM":
      return { status: "permission_denied", reasonCode: "PERMISSION_DENIED" };
    case "EINVAL":
    case "ENAMETOOLONG":
      return { status: "invalid_path", reasonCode: "INVALID_PATH" };
    default:
      // EIO, ETIMEDOUT, ENOTCONN, ENXIO, etc. — an ambiguous or
      // transient filesystem error, e.g. a network share that started
      // timing out mid-operation. Never confidently "missing".
      return { status: "path_temporarily_unavailable", reasonCode: "PATH_TEMPORARILY_UNAVAILABLE" };
  }
}
