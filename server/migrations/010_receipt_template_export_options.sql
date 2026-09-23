ALTER TABLE receipt_registrations
  ADD COLUMN IF NOT EXISTS receipt_item VARCHAR(500) NOT NULL DEFAULT 'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ',
  ADD COLUMN IF NOT EXISTS include_receipt_item TINYINT(1) NOT NULL DEFAULT 1;

INSERT IGNORE INTO schema_migrations (version, name)
VALUES (10, 'receipt_template_export_options');
