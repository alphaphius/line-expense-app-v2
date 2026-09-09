ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS source_user_name VARCHAR(255) NOT NULL DEFAULT '' AFTER source_user_id;

CREATE TABLE IF NOT EXISTS line_users (
  user_id VARCHAR(160) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL DEFAULT '',
  picture_url VARCHAR(1000) NOT NULL DEFAULT '',
  first_seen_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  INDEX idx_line_users_display_name (display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO line_users (user_id, display_name, picture_url, first_seen_at, last_seen_at)
SELECT source_user_id,
       MAX(CASE WHEN source_user_name <> '' THEN source_user_name ELSE 'ผู้ส่งผ่าน LINE' END),
       '',
       MIN(created_at),
       MAX(updated_at)
FROM bills
WHERE source = 'LINE' AND source_user_id <> ''
GROUP BY source_user_id
ON DUPLICATE KEY UPDATE
  display_name = IF(line_users.display_name = '' OR line_users.display_name = 'ผู้ส่งผ่าน LINE', VALUES(display_name), line_users.display_name),
  last_seen_at = GREATEST(line_users.last_seen_at, VALUES(last_seen_at));
