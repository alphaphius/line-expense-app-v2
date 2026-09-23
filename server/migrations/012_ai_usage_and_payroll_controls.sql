CREATE TABLE IF NOT EXISTS ai_quota_settings (
  scope_key VARCHAR(32) PRIMARY KEY,
  plan_name VARCHAR(40) NOT NULL DEFAULT 'FREE',
  request_limit_day BIGINT UNSIGNED NOT NULL DEFAULT 0,
  token_limit_day BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ai_quota_settings (scope_key, plan_name, request_limit_day, token_limit_day, updated_at)
VALUES
  ('BILLS', 'FREE', 0, 0, UTC_TIMESTAMP(3)),
  ('RECEIPTS', 'FREE', 0, 0, UTC_TIMESTAMP(3));

INSERT IGNORE INTO schema_migrations (version, name)
VALUES (12, 'ai_usage_and_payroll_controls');
