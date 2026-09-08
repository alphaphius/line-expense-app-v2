CREATE TABLE IF NOT EXISTS line_webhook_events (
  event_id VARCHAR(160) PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL DEFAULT '',
  source_type VARCHAR(40) NOT NULL DEFAULT '',
  source_id VARCHAR(160) NOT NULL DEFAULT '',
  message_id VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
  error TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  INDEX idx_line_events_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS line_upload_pages (
  session_id VARCHAR(64) NOT NULL,
  page_no SMALLINT UNSIGNED NOT NULL,
  message_id VARCHAR(160) NOT NULL,
  file_path VARCHAR(700) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  original_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  compression VARCHAR(80) NOT NULL DEFAULT '',
  width INT UNSIGNED NOT NULL DEFAULT 0,
  height INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (session_id, page_no),
  UNIQUE KEY uq_line_upload_message (message_id),
  CONSTRAINT fk_line_upload_session FOREIGN KEY (session_id) REFERENCES upload_sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
