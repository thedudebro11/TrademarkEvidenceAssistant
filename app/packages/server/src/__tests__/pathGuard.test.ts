import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { PathTraversalError, resolveSafePath } from "../security/pathGuard.js";

describe("resolveSafePath", () => {
  const root = "/tmp/fake-evidence-root";

  it("resolves a simple relative path inside root", () => {
    expect(resolveSafePath(root, "photo.jpg")).toBe(join(root, "photo.jpg"));
  });

  it("resolves a nested relative path inside root", () => {
    expect(resolveSafePath(root, "Proof Files/proof (1).pdf")).toBe(
      join(root, "Proof Files/proof (1).pdf"),
    );
  });

  it("rejects a parent-directory traversal attempt", () => {
    expect(() => resolveSafePath(root, "../../etc/passwd")).toThrow(
      PathTraversalError,
    );
  });

  it("rejects an absolute path outside root", () => {
    expect(() => resolveSafePath(root, "/etc/passwd")).toThrow(
      PathTraversalError,
    );
  });

  it("rejects a path that traverses out and back to a sibling directory", () => {
    expect(() =>
      resolveSafePath(root, "../fake-evidence-root-evil/file.txt"),
    ).toThrow(PathTraversalError);
  });

  it("allows the root itself", () => {
    expect(resolveSafePath(root, ".")).toBe(join(root));
  });
});
