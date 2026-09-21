CREATE TABLE IF NOT EXISTS workhub_module_snapshots (
  snapshot_id CHAR(36) NOT NULL PRIMARY KEY,
  module_key VARCHAR(40) NOT NULL,
  snapshot_date DATE NOT NULL,
  snapshot_slot CHAR(5) NOT NULL,
  state_json LONGTEXT NOT NULL,
  source_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_workhub_module_snapshot_slot (module_key,snapshot_date,snapshot_slot),
  INDEX idx_workhub_module_snapshots_recent (module_key,snapshot_date,snapshot_slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
