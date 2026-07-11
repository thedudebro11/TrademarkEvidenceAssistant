# 03 — Evidence Item Model

Every source file becomes an Evidence Item.

## Core fields
id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256, discovered_at, raw timestamps, preview_type, review_status, evidence_category, file_role, usefulness_band, usefulness_score, explanation, notes, exported state.

## Status
unreviewed, in_review, reviewed, needs_follow_up, excluded.

## Category
trademark_core, trademark_supporting, business_history, archive_only, unknown.

## Roles
product_photo, customer_photo, marketing_photo, social_post_export, printful_invoice, printful_order, shipping_record, payment_record, message, logo_source, logo_export, product_design, packaging, specimen_candidate, video, document, duplicate, unknown.

Store objective content, user statements, links, and inferences separately.
