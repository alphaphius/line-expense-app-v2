CREATE TABLE IF NOT EXISTS workhub_module_state (
  module_key VARCHAR(40) NOT NULL PRIMARY KEY,
  state_json LONGTEXT NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(160) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_workhub_module_state_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workhub_module_files (
  module_key VARCHAR(40) NOT NULL,
  file_key VARCHAR(220) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  file_path VARCHAR(700) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  updated_by VARCHAR(160) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (module_key,file_key),
  INDEX idx_workhub_module_files_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
