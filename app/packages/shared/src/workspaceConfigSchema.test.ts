import { describe, expect, it } from "vitest";
import { WorkspaceConfigSchema } from "./workspaceConfigSchema.js";

describe("WorkspaceConfigSchema", () => {
  it("accepts a valid config", () => {
    const result = WorkspaceConfigSchema.parse({ activeWorkspace: "Fatletic" });
    expect(result.activeWorkspace).toBe("Fatletic");
  });

  it("rejects a missing activeWorkspace", () => {
    expect(() => WorkspaceConfigSchema.parse({})).toThrow();
  });

  it("rejects an empty activeWorkspace string", () => {
    expect(() => WorkspaceConfigSchema.parse({ activeWorkspace: "" })).toThrow();
  });

  it("rejects a non-string activeWorkspace", () => {
    expect(() => WorkspaceConfigSchema.parse({ activeWorkspace: 42 })).toThrow();
  });
});
