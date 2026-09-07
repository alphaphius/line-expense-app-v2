# WorkHub data model

| Sheet | Purpose | Stable key |
| --- | --- | --- |
| `ReceiptTemplates` | Uploaded and normalized DOCX templates | `template_id` |
| `LaborGroups` | Permanent, site-linked, or custom labor groups | `group_id` |
| `Workers` | Canonical people shared with attendance/payroll | `worker_id` |
| `WorkerGroupMembers` | Many-to-many group membership | `membership_id` |
| `ReceiptBatches` | Batch processing status and counters | `batch_id` |
| `ReceiptRegistrations` | OCR result, corrections, card file, duplicate state | `registration_id` |
| `GeneratedDocuments` | Generated DOCX/XLSX audit and Drive reference | `generated_id` |

National ID values must remain text so leading zeroes are preserved. Public client
objects return only a masked ID for saved records unless a protected editing action
explicitly requires the full value. The current anonymous session model does not
meet that protected-access requirement, so production enablement is gated.
