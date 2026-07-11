import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { PathTraversalError, resolveSafePath } from "../security/pathGuard.js";

describe("resolveSafePath", () => {
  // Must be a genuinely platform-absolute path. A hardcoded POSIX literal
  // like "/tmp/fake-evidence-root" is *not* absolute on Windows — Node
  // treats a leading "/" with no drive letter as drive-relative, so
  // path.resolve() silently prepends the current drive (e.g. "C:") while
  // path.join() does not, making the two diverge. Real callers always
  // pass a properly resolved OS-native absolute path (e.g.
  // workspace.evidenceRoot), so that mismatch never happens outside this
  // kind of hardcoded test fixture.
  const root = resolve(tmpdir(), "fake-evidence-root");

  it("resolves a simple relative path inside root", () => {
    expect(resolveSafePath(root, "photo.jpg")).toBe(resolve(root, "photo.jpg"));
  });

  it("resolves a nested relative path inside root", () => {
    expect(resolveSafePath(root, "Proof Files/proof (1).pdf")).toBe(
      resolve(root, "Proof Files/proof (1).pdf"),
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
    expect(resolveSafePath(root, ".")).toBe(resolve(root));
  });
});
