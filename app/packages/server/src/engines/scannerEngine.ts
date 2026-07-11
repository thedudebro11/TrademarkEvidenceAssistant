import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Directory names that are never descended into, even if found inside an
 * evidence root. Defensive per spec 04 ("ignore app/cache/database/
 * export/generated folders") — and concretely justified during this
 * project's own Phase 0/1 work, where this session's tooling twice
 * created a stray `.claude/` directory inside the real evidence folder
 * (see docs/RISKS.md #5). A scanner that blindly walked everything would
 * have turned that into a fake "evidence item."
 */
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".claude",
  "app",
  "cache",
  "generated",
  "exports",
  "reports",
  ".ds_store",
]);

export interface DiscoveredFile {
  /** Path relative to the scan root, using forward slashes. */
  relativePath: string;
  absolutePath: string;
  fileSize: number;
  fsCreatedAt: string;
  fsModifiedAt: string;
}

/**
 * Recursively discovers files under `rootDir`, skipping directories in
 * `IGNORED_DIR_NAMES` (case-insensitive). Pure filesystem discovery only
 * — no hashing, no metadata extraction, no persistence. Per
 * docs/ARCHITECTURE_CONSTITUTION.md #7, the Scanner's responsibilities
 * are narrow; this engine is the "discover files" piece only.
 */
export function discoverFiles(rootDir: string): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];
  walk(rootDir, rootDir, results);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

function walk(rootDir: string, currentDir: string, results: DiscoveredFile[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) {
        continue;
      }
      walk(rootDir, join(currentDir, entry.name), results);
      continue;
    }

    if (!entry.isFile()) {
      // Symlinks, sockets, etc. are not evidence — skip deterministically
      // rather than guessing.
      continue;
    }

    const absolutePath = join(currentDir, entry.name);
    const stats = statSync(absolutePath);

    results.push({
      relativePath: relative(rootDir, absolutePath).split("\\").join("/"),
      absolutePath,
      fileSize: stats.size,
      fsCreatedAt: stats.birthtime.toISOString(),
      fsModifiedAt: stats.mtime.toISOString(),
    });
  }
}
