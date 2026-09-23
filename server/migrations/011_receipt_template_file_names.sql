ALTER TABLE receipt_templates
  ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(255) NOT NULL DEFAULT '';

UPDATE receipt_templates
SET source_file_name = CONCAT(template_name, '.', LOWER(source_format))
WHERE source_file_name = '';

INSERT IGNORE INTO schema_migrations (version, name)
VALUES (11, 'receipt_template_file_names');
