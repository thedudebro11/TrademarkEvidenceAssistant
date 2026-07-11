import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walks up from a starting directory looking for `.git`, which marks the
 * repository root. This avoids hardcoding how many directories deep the
 * server package sits (works the same under `tsx` from source and under
 * compiled `dist/`, since both preserve the same relative depth from the
 * repo root).
 */
export function findRepoRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not locate repository root (no .git found) starting from ${startDir}`,
      );
    }
    current = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root, resolved once at module load. */
export const REPO_ROOT = findRepoRoot(here);
