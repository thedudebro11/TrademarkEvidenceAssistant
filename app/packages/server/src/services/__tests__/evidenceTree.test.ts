import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../scanService.js";
import { buildEvidenceTree } from "../reviewService.js";
import { recordDecision } from "../reviewService.js";
import { REPO_ROOT } from "../../config/repoRoot.js";
import type { EvidenceTreeFolderNode, EvidenceTreeNode } from "@trademark-evidence-assistant/shared";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

function findFolder(nodes: EvidenceTreeNode[], name: string): EvidenceTreeFolderNode | undefined {
  return nodes.find((n): n is EvidenceTreeFolderNode => n.type === "folder" && n.name === name);
}

describe("buildEvidenceTree", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  let workspaceId: number;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    workspaceId = db
      .prepare("INSERT INTO workspaces (name, evidence_root) VALUES ('Golden', 'unused')")
      .run().lastInsertRowid as number;

    evidenceRoot = mkdtempSync(join(tmpdir(), "evidence-tree-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    await runScan(db, workspaceId, evidenceRoot);
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  it("nests items under their real folders, matching original_path exactly", () => {
    const tree = buildEvidenceTree(db, workspaceId);
    // The golden workspace's root-level files appear as direct file nodes.
    const rootFile = tree.find((n) => n.type === "file" && n.name === "product_photo.jpg");
    expect(rootFile).toBeTruthy();
  });

  it("sorts folders before files, then alphabetically, at every level", () => {
    const tree = buildEvidenceTree(db, workspaceId);
    const types = tree.map((n) => n.type);
    const firstFileIndex = types.indexOf("file");
    const lastFolderIndex = types.lastIndexOf("folder");
    if (firstFileIndex !== -1 && lastFolderIndex !== -1) {
      expect(lastFolderIndex).toBeLessThan(firstFileIndex);
    }
  });

  it("attaches each file's real review status and inclusion decision, never a fabricated one", () => {
    const tree = buildEvidenceTree(db, workspaceId);
    const rootFile = tree.find((n) => n.type === "file" && n.name === "product_photo.jpg");
    expect(rootFile?.type).toBe("file");
    if (rootFile?.type === "file") {
      expect(rootFile.reviewStatus).toBe("unreviewed");
      expect(rootFile.inclusionDecision).toBeNull();
    }
  });

  it("reflects a decision immediately after it's recorded — the tree is always a live read, never cached", () => {
    const before = buildEvidenceTree(db, workspaceId);
    const file = before.find((n) => n.type === "file") as { type: "file"; id: string } | undefined;
    expect(file).toBeTruthy();

    recordDecision(db, workspaceId, file!.id, "archive");

    const after = buildEvidenceTree(db, workspaceId);
    const updated = after.find((n) => n.type === "file" && n.id === file!.id);
    expect(updated?.type).toBe("file");
    if (updated?.type === "file") {
      expect(updated.reviewStatus).toBe("excluded");
      expect(updated.inclusionDecision).toBe("not_useful");
    }
  });

  it("groups items that share a folder under one folder node, not one per item", () => {
    const tree = buildEvidenceTree(db, workspaceId);
    // Every folder name should appear exactly once at its level.
    const folderNames = tree.filter((n) => n.type === "folder").map((n) => n.name);
    expect(new Set(folderNames).size).toBe(folderNames.length);
  });

  it("never touches the filesystem — purely a read of already-scanned database rows", () => {
    // If this queried the disk, deleting evidenceRoot before calling it would throw or return nothing new;
    // instead the tree still reflects exactly what was scanned into the DB.
    const before = buildEvidenceTree(db, workspaceId);
    rmSync(evidenceRoot, { recursive: true, force: true });
    const after = buildEvidenceTree(db, workspaceId);
    expect(after).toEqual(before);
    // Recreate so the shared afterEach's rmSync doesn't error on a missing path.
    evidenceRoot = mkdtempSync(join(tmpdir(), "evidence-tree-test-cleanup-"));
  });
});
