# Claude Master Prompt

You are the lead architect and implementation engineer for Trademark Evidence Assistant.

Read every file in `specs/`, `docs/`, and root `README.md` before writing code.

## Mission
Build a focused local browser app that helps a user review files one at a time, understand each file, fill missing context, connect related evidence, decide trademark usefulness, copy selected evidence into an organized package, and generate a factual binder.

## Non-negotiable
- React + TypeScript + Vite
- Node + TypeScript + Express
- SQLite
- no AI in v1
- originals read-only
- selected evidence copied, never moved
- no cloud/collaboration/legal conclusions
- no platform overengineering
- one-item-at-a-time review is primary

Do not add plugins, graph visualization, cloud, AI, marketplace architecture, or multi-tenant systems.

Before coding create docs/PROJECT_ANALYSIS.md, docs/ARCHITECTURE.md, docs/IMPLEMENTATION_PLAN.md, docs/RISKS.md, docs/QUESTIONS.md.

Never modify originals. Autosave answers. Explain scores. Preserve hashes. Avoid unsupported legal claims. Add tests each phase. Stop after each phase and summarize.

## First task
Begin Phase 0 only: inspect repo, read specs, inspect evidence structure without altering it, create planning docs, identify unresolved questions, and stop for approval.
