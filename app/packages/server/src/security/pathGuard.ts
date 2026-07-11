import { resolve, sep } from "node:path";

/**
 * Resolves `requestedRelativePath` against `rootDir` and throws if the
 * resolved path escapes `rootDir` (path traversal, absolute-path
 * injection, etc). Every filesystem access built from request input
 * must go through this — see docs/ARCHITECTURE.md "Security boundary"
 * and docs/RISKS.md #1.
 *
 * No scanning/preview logic depends on this yet in Phase 1; it exists
 * now because it is foundational and future phases must not be able to
 * skip it.
 */
export function resolveSafePath(
  rootDir: string,
  requestedRelativePath: string,
): string {
  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(resolvedRoot, requestedRelativePath);

  const rootWithSep = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : resolvedRoot + sep;

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new PathTraversalError(requestedRelativePath, resolvedRoot);
  }

  return resolvedTarget;
}

export class PathTraversalError extends Error {
  constructor(requestedRelativePath: string, rootDir: string) {
    super(
      `Refusing to resolve "${requestedRelativePath}" outside of root "${rootDir}"`,
    );
    this.name = "PathTraversalError";
  }
}
