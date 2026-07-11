The goal of Trademark Evidence Assistant is not to organize files.

The goal is to help a person understand which evidence they have, which evidence they are missing, how their evidence connects together, and how to assemble a truthful, well-organized trademark evidence package without ever altering the original evidence.
# Architecture Constitution

Before beginning Phase 2, adopt the following architectural principles.

These are not feature requests.

These are permanent design principles that every future phase should follow.

If any future implementation conflicts with these principles, these principles take priority.

---

# 1. Every feature must help the user make one better evidence decision.

This application exists for one purpose:

Help the user determine whether a piece of evidence strengthens a trademark evidence package.

Every screen...

Every service...

Every workflow...

Every interaction...

should ultimately support that decision.

If a proposed feature does not make the review process faster, clearer, more accurate, or more trustworthy, it does not belong in Version 1.

Always favor clarity over complexity.

---

# 2. Introduce an Application Service Layer

The architecture should become:

Frontend

↓

HTTP API

↓

Application Services

↓

Filesystem
SQLite
Metadata
Exports

Never allow Express routes to contain business logic.

Every route should delegate to a dedicated service.

Suggested services:

ScanService

MetadataService

ReviewService

ConnectionService

ExportService

BinderService

WorkspaceService

SettingsService

Each service owns one business capability.

Business rules should exist exactly once.

---

# 3. Create a dedicated Review Engine

The Review Engine becomes the heart of the application.

Everything ultimately revolves around reviewing evidence.

The Review Engine should own:

Next Item

Previous Item

Skip

Resume

Autosave

Review Progress

Needs Follow-Up

Completed

Remaining

Review History

Current Review State

The UI should simply display the Review Engine's state.

Business logic belongs inside the Review Engine.

---

# 4. Preserve the separation between suggestions and confirmed facts

Never blur these concepts.

Example:

Suggested Role

↓

Print Vendor Proof

Confidence

Medium

Reason

Filename contains "proof"

Folder is "Proof Files"

This is only a suggestion.

The user confirms:

Confirmed Role

↓

Print Vendor Proof

Only the confirmed role becomes the official classification.

Suggestions remain suggestions forever.

---

# 5. Preserve confidence separately

Every Evidence Item should eventually expose multiple confidence dimensions.

Metadata Confidence

How trustworthy is the extracted metadata?

User Confidence

How confident is the user's supplied information?

Connection Confidence

How well supported are the evidence connections?

Overall Evidence Confidence

A transparent combination of the above.

Never reduce confidence to one unexplained number.

Always explain why.

---

# 6. Generated data is separate from evidence

The generated database location is correct.

Continue using:

generated/

for:

SQLite

Indexes

Cache

Reports

Thumbnails

Temporary files

Never store generated data beside original evidence.

Original evidence remains immutable.

---

# 7. Scanner responsibilities are intentionally narrow

The Scanner should perform only four responsibilities.

Discover files.

Create Evidence Items.

Extract deterministic metadata.

Persist results.

Then stop.

The Scanner should NOT:

review evidence

score evidence

ask questions

create connections

build reports

export evidence

generate binders

perform trademark analysis

The Scanner discovers.

Nothing more.

---

# 8. Build small engines

Favor many small engines over large monolithic systems.

Example:

Scanner Engine

Metadata Engine

Review Engine

Connection Engine

Export Engine

Binder Engine

Each engine should have one responsibility.

Each engine should be independently testable.

---

# 9. Favor deterministic behavior

Version 1 intentionally contains no AI.

Every result should be explainable.

Every suggestion should identify:

why it exists

what produced it

how confident it is

Nothing should appear "magically."

---

# 10. Continue Phase 2

Phase 2 should continue using these principles.

Do not redesign Phase 1.

Do not rewrite working code.

Extend the architecture using these rules.

If implementation reveals a better architecture, document the reasoning before changing it.

Otherwise continue building.
