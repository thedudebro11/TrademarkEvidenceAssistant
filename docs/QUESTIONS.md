# Phase 0 Questions — Resolved

All 8 Phase 0 questions were answered by the user before Phase 1 began.
Recorded here for reference; each decision is reflected in the code/docs
noted below.

1. **npm/WSL environment issue** — Resolved: Windows PowerShell is the
   canonical day-to-day environment. Not fixing the WSL `.npmrc` prefix
   conflict. See `docs/SETUP.md`.

2. **Package layout** — Resolved: single npm workspace root at `app/`
   with `packages/server`, `packages/web`, `packages/shared`. Built in
   Phase 1.

3. **Golden test workspace** — Resolved: lives at
   `tests/fixtures/golden-workspace/` (tracked in git). Directory
   scaffolded in Phase 1; populated with synthetic fixtures in Phase 2.

4. **Role inference from folder names** — Resolved: deterministic
   suggestions allowed, never automatic final classification. Store
   `suggestedRole` + `reason` + `confidence` separately from a
   user-`confirmedRole`. Modeled in
   `app/packages/shared/src/models.ts` (`RoleSuggestion`,
   `ConfirmedRole`) — suggestion-generation logic itself is Phase 2+.

5. **`Proof Files/` PDFs** — Resolved: added `print_vendor_proof` to the
   `FileRole` enum (`app/packages/shared/src/enums.ts`) rather than
   defaulting to `printful_invoice`/`printful_order`. The user must
   confirm which of proof / order / invoice / other applies.

6. **Near-duplicate videos** — Resolved: v1 only detects exact duplicates
   via SHA-256. Added `duplicate_variant_of` to `ConnectionType`
   alongside `related_to` for manual linking of near-duplicate media.
   No automatic similarity detection.

7. **Second workspace, ever?** — Resolved: stay workspace-aware in the
   schema/backend (`workspace_id`, `workspace.config.json`), no
   workspace switcher in v1 UI. No hardcoded "Fatletic" logic in
   shared/core — the active workspace name is data
   (`workspace.config.json`), read by
   `app/packages/server/src/config/workspaceConfig.ts`.

8. **Business-planning text files** — Resolved: scanned and reviewed
   normally, suggested category `business_history`, never
   auto-excluded. Applies starting Phase 2 (scanner).
