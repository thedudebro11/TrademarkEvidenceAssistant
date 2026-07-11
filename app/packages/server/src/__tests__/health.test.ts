import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp } from "../app.js";
import { runMigrations } from "../db/migrate.js";
import type { ResolvedWorkspace } from "../config/workspaceConfig.js";
import type { HealthResponse } from "@trademark-evidence-assistant/shared";

describe("GET /api/health", () => {
  let db: Database.Database;
  const workspace: ResolvedWorkspace = {
    name: "TestWorkspace",
    evidenceRoot: "/nonexistent/evidence/root",
    evidenceRootExists: false,
    databasePath: ":memory:",
  };

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("reports ok status with workspace and database info", async () => {
    const app = createApp(db, workspace, 1);
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    const body = res.body as HealthResponse;
    expect(body.status).toBe("ok");
    expect(body.database.connected).toBe(true);
    expect(body.workspace.name).toBe("TestWorkspace");
    expect(body.workspace.evidenceRootExists).toBe(false);
  });
});
