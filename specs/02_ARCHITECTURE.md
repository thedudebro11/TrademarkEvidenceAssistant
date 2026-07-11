# 02 — Architecture

Local browser app:
- React + TypeScript + Vite
- Node + TypeScript + Express
- SQLite
- filesystem access through backend only

Flow: Frontend → HTTP API → application services → SQLite + read-only filesystem layer.

Original files remain authoritative source bytes. SQLite stores Evidence Items, metadata, review answers, connections, statuses, scores, export state, and audit history.

Allowed: read, hash, extract metadata, generate cache previews, copy approved files.
Forbidden: alter, rename, move, delete, or write sidecars beside originals.
