# Evidence Handling Policy

This document defines how raw evidence is stored, accessed, and processed
within the Trademark Evidence Assistant project.

## 1. Originals are read-only

Raw evidence files placed under `workspaces/<client>/evidence/` (for example
`workspaces/Fatletic/evidence/`) are treated as **read-only source material**.
Once evidence is placed in this location, it should not be altered.

## 2. Never modify originals

The application, scripts, and any automated tooling must never write to,
overwrite, compress, convert, or otherwise mutate files inside an evidence
directory. If a transformed version of a file is needed (e.g. a resized
image, an extracted text layer, a converted format), it must be written to a
separate generated-output location (see Section 3), never back into the
evidence folder.

## 3. Never rename originals without approval

Evidence file names may carry meaning (dates, versions, client-provided
labels). Do not rename, move, or restructure files within an evidence
directory without explicit approval from the evidence owner. Automated
processes must reference files by their original name/path rather than
renaming them for convenience.

## 4. Generated outputs are separate from originals

The application may create the following **outside** of evidence
directories, typically under `reports/`, `exports/`, or `generated/`:

- Metadata extracted from evidence files
- Thumbnails and previews
- Search indexes / embeddings
- Review decisions and classification results
- Reports summarizing evidence findings

These generated artifacts must be clearly separated from originals, must be
regenerable from the originals at any time, and must never be treated as a
replacement for the source evidence.

## 5. Raw evidence is not committed to Git

Directories matching `workspaces/*/evidence/` are excluded from version
control via `.gitignore`. Evidence lives on disk (and in whatever backup
system the user maintains) — not in the Git history of this repository.
This keeps the repository small, avoids leaking sensitive material into
commit history, and avoids duplicating storage a version control system
isn't designed for.

## 6. Evidence may contain sensitive information

Evidence files may contain private, customer, legal, or otherwise sensitive
business information (e.g. customer photos, invoices, correspondence,
unreleased designs). Treat all evidence directories as confidential:

- Do not upload evidence contents to third-party services.
- Do not include raw evidence contents in logs, error messages, or shared
  reports without deliberate, reviewed redaction.
- Generated reports that summarize evidence should avoid restating
  sensitive details beyond what is necessary for the review purpose.

## 7. Scope

This policy applies to all evidence workspaces under `workspaces/`,
present and future, regardless of client or matter name.
