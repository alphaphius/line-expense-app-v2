UPDATE line_inbox
SET available_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
WHERE status IN ('PENDING','RETRY') AND available_at > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE);

UPDATE line_outbox
SET available_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
WHERE status IN ('PENDING','RETRY') AND available_at > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE);
