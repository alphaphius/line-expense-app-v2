# Phius WorkHub

Phius WorkHub is the product name for the expanded operations app. The existing
expense and LINE OA workflow remains intact, while non-LINE modules share the
same projects and future workforce records.

## Primary navigation

1. ค่าใช้จ่าย — the existing expense dashboard, bill list, upload, and settings.
2. เอกสารใบรับเงิน — DOC/DOCX templates, Thai ID OCR, quick edit, grouping, and export.
3. สรุปค่าแรง — planned; consumes the stable `worker_id` created by the receipt module.
4. Task manager — planned.

## Payment receipt flow

1. An operator uploads one active DOC or DOCX template. The supported placeholders
   are `{ชื่อสกุล}`, `{เลขบัตร}`, and `{ที่อยู่}`. Legacy DOC files are normalized to
   DOCX before use.
2. The operator selects a labor group and uploads one or more Thai ID-card images.
3. The browser converts each image to JPEG, corrects orientation, limits its long
   edge, and targets a small payload before upload.
4. Cards are processed independently with bounded concurrency. A failed card can
   be retried without repeating cards that already succeeded.
5. Tesseract.js reads Thai text locally in the browser; no Gemini request is made for ID cards.
6. Each result appears immediately as a quick-edit row. The operator corrects OCR
   values and saves all ready rows.
7. Duplicate checks run against normalized 13-digit ID, image SHA-256, and a
   normalized name/address fallback. Exact matches are blocked until reviewed;
   weak matches are warnings.
8. Export preview lists every selected person grouped by site and shows the total.
9. DOCX export repeats the complete template for each selected person, then adds
   that person's compressed ID image on a new page. XLSX exports the selected roster.

## Data and sync contract

- `worker_id` is immutable and is the future attendance/payroll join key.
- A worker may belong to one or more labor groups through membership records.
- `project_id` is reused for site-linked groups; ad-hoc groups may omit it.
- Batch uploads and exports use immutable request IDs for idempotency.
- Sensitive API responses are never service-worker cached.

## Protected access

Thai national ID numbers, addresses, and card images are sensitive personal data.
The expense and bill workspace remains open. Payment receipts, payroll, tasks, and
the database link require a short-lived server-issued protected session. The shared
password verifier is salted and stored only in Apps Script Properties, login attempts
are rate-limited, and the browser keeps only an opaque token in session storage.

## Initial operating limits

- Up to 40 ID cards per batch in the UI.
- One OCR worker on mobile and up to two on capable desktop devices to control memory use.
- OCR runtime and Thai language files are self-hosted and cached after first use.
- One compressed card image per request; target 700 KB and 1,600 px long edge.
- Up to 200 people per combined DOCX export; larger sets must be split.
- DOCX templates are limited to 8 MB after normalization.
