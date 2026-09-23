ALTER TABLE labor_groups
  ADD COLUMN IF NOT EXISTS report_site_id VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS site_code VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS province VARCHAR(160) NOT NULL DEFAULT '';

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS nickname VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS daily_wage DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note TEXT NULL,
  ADD COLUMN IF NOT EXISTS wage_effective_date DATE NULL;

DROP INDEX IF EXISTS uq_workers_national_id ON workers;
CREATE INDEX IF NOT EXISTS idx_workers_national_id ON workers (national_id);

ALTER TABLE receipt_registrations
  ADD COLUMN IF NOT EXISTS nickname VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS daily_wage DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note TEXT NULL,
  ADD COLUMN IF NOT EXISTS ai_next_attempt_at DATETIME(3) NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_ai_queue
  ON receipt_registrations (status, ai_next_attempt_at, updated_at);

INSERT IGNORE INTO schema_migrations (version, name)
VALUES (9, 'receipt_payroll_sync');
