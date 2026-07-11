# Setup and Run (Windows PowerShell)

Per Phase 0 decision, **Windows PowerShell is the canonical local
development environment** for this project — the repository lives on the
Windows filesystem, and there is no benefit to a WSL-specific workflow.
The commands below are written for PowerShell (or cmd.exe); they are
plain `npm` commands and work the same in any shell.

## Prerequisites

- Node.js >= 20 (`node --version`)
- npm >= 10 (bundled with Node)

## One-time setup

```powershell
cd C:\Users\oscar\TrademarkEvidenceAssistant\app
npm install
```

`npm install` runs a `postinstall` step that builds the `shared` package
(`packages/shared`) so `server` and `web` can resolve it immediately. If
you ever edit `packages/shared/src/*` and don't see the change reflected
in the server or web app, rebuild it manually:

```powershell
npm run build -w @trademark-evidence-assistant/shared
```

## Day-to-day development

Run both the backend and frontend dev servers together:

```powershell
npm run dev
```

This starts:
- `@trademark-evidence-assistant/server` on **http://localhost:4000**
  (via `tsx watch`, auto-restarts on change)
- `@trademark-evidence-assistant/web` on **http://localhost:5173**
  (via Vite, hot-reloads on change; proxies `/api` to the server)

Open http://localhost:5173 — the page should show workspace/database
status pulled live from the backend's health check.

## Verifying the backend directly

```powershell
curl http://localhost:4000/api/health
```

Expect a JSON body like:

```json
{
  "status": "ok",
  "workspace": { "name": "Fatletic", "evidenceRoot": "...", "evidenceRootExists": true },
  "database": { "connected": true }
}
```

## Database / migrations

The SQLite database lives at `generated/<workspace>/app.db` (git-ignored,
created automatically). To apply migrations without starting the server:

```powershell
npm run migrate
```

## Typecheck, test, build

```powershell
npm run typecheck   # tsc --noEmit across all packages
npm run test        # vitest run across all packages
npm run build        # builds shared, then server, then web
```

After `npm run build`, the compiled server can be run standalone:

```powershell
npm run start -w @trademark-evidence-assistant/server
```

## Active workspace configuration

The active evidence workspace is set in `workspace.config.json` at the
repository root:

```json
{ "activeWorkspace": "Fatletic" }
```

There is no workspace switcher in v1 UI (Phase 0 decision 7) — change
this file and restart the server to point at a different
`workspaces/<name>/evidence/` directory.

## Known environment note (WSL)

If you ever run this project's tooling from WSL instead of PowerShell,
`npm --version` may print a `config prefix cannot be changed from
project config` warning caused by a Windows-path `prefix` in
`/mnt/c/Users/<you>/.npmrc`. This does not block `npm install` or any
script — it's a non-fatal warning. Per Phase 0 decision, we are not
fixing it, since PowerShell is the intended workflow.
