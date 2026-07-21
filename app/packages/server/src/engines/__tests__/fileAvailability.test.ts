import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:os";
import { classifyFileAvailability } from "../fileAvailability.js";

describe("classifyFileAvailability", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "file-availability-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("2. reports an existing file as available", () => {
    const filePath = join(root, "IMG_1.heic");
    writeFileSync(filePath, "content");
    const result = classifyFileAvailability(root, filePath);
    expect(result.status).toBe("available");
    expect(result.reasonCode).toBeNull();
  });

  it("reports a genuinely deleted file (no such path, root itself still reachable) as MISSING_FILE", () => {
    const filePath = join(root, "gone.heic");
    const result = classifyFileAvailability(root, filePath);
    expect(result.status).toBe("missing");
    expect(result.reasonCode).toBe("MISSING_FILE");
  });

  it("3. reports every path under an unreachable evidence root as drive_unavailable, never confidently missing", () => {
    const unreachableRoot = join(root, "does-not-exist-drive");
    const filePath = join(unreachableRoot, "IMG_1.heic");
    const result = classifyFileAvailability(unreachableRoot, filePath);
    expect(result.status).toBe("drive_unavailable");
    expect(result.reasonCode).toBe("DRIVE_UNAVAILABLE");
  });

  it("classifies a path through a non-directory component as missing (parent restructured), not a crash", () => {
    const notADir = join(root, "actually-a-file.txt");
    writeFileSync(notADir, "x");
    const filePath = join(notADir, "IMG_1.heic");
    const result = classifyFileAvailability(root, filePath);
    expect(result.status).toBe("missing");
    expect(result.reasonCode).toBe("MISSING_FILE");
  });

  it.skipIf(platform() === "win32")("reports a permission-denied directory as permission_denied, not missing", () => {
    const restrictedDir = join(root, "restricted");
    mkdirSync(restrictedDir);
    const filePath = join(restrictedDir, "IMG_1.heic");
    writeFileSync(filePath, "content");
    chmodSync(restrictedDir, 0o000);
    try {
      const result = classifyFileAvailability(root, filePath);
      expect(result.status).toBe("permission_denied");
      expect(result.reasonCode).toBe("PERMISSION_DENIED");
    } finally {
      chmodSync(restrictedDir, 0o755);
    }
  });
});
