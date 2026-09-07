CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value LONGTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  project_id VARCHAR(64) PRIMARY KEY,
  project_code VARCHAR(80) NOT NULL DEFAULT '',
  project_name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_projects_active_name (active, project_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS companies (
  company_id VARCHAR(64) PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  branch_name VARCHAR(160) NOT NULL DEFAULT '',
  tax_id VARCHAR(32) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_companies_active_name (active, company_name),
  INDEX idx_companies_tax_id (tax_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  category_id VARCHAR(64) PRIMARY KEY,
  category_name VARCHAR(255) NOT NULL,
  aliases TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_categories_active_name (active, category_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id VARCHAR(64) PRIMARY KEY,
  vendor_name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  tax_id VARCHAR(32) NOT NULL DEFAULT '',
  branch_name VARCHAR(160) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_vendors_normalized_tax (normalized_name, tax_id),
  INDEX idx_vendors_usage (use_count, last_used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS upload_sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  company_id VARCHAR(64) NOT NULL DEFAULT '',
  expected_pages SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  received_pages SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'WEB',
  source_user_id VARCHAR(160) NOT NULL DEFAULT '',
  source_context_id VARCHAR(160) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_upload_sessions_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bills (
  bill_id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  company_id VARCHAR(64) NOT NULL DEFAULT '',
  category_id VARCHAR(64) NOT NULL DEFAULT '',
  doc_type VARCHAR(80) NOT NULL DEFAULT '',
  document_no VARCHAR(160) NOT NULL DEFAULT '',
  document_date DATE NULL,
  due_date DATE NULL,
  vendor_id VARCHAR(64) NOT NULL DEFAULT '',
  vendor_name VARCHAR(255) NOT NULL DEFAULT '',
  vendor_tax_id VARCHAR(32) NOT NULL DEFAULT '',
  vendor_branch VARCHAR(160) NOT NULL DEFAULT '',
  vendor_address TEXT NOT NULL,
  buyer_name VARCHAR(255) NOT NULL DEFAULT '',
  buyer_tax_id VARCHAR(32) NOT NULL DEFAULT '',
  buyer_address TEXT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'THB',
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  vat_rate DECIMAL(7,3) NOT NULL DEFAULT 0,
  vat_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  withholding_tax DECIMAL(15,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(120) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  notes TEXT NOT NULL,
  page_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  image_quality VARCHAR(40) NOT NULL DEFAULT '',
  quality_score DECIMAL(7,3) NOT NULL DEFAULT 0,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  review_reasons JSON NULL,
  company_match TINYINT(1) NULL,
  tax_id_match TINYINT(1) NULL,
  address_match TINYINT(1) NULL,
  duplicate_key VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  source VARCHAR(32) NOT NULL DEFAULT 'WEB',
  source_user_id VARCHAR(160) NOT NULL DEFAULT '',
  source_context_id VARCHAR(160) NOT NULL DEFAULT '',
  folder_path VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  confirmed_at DATETIME(3) NULL,
  INDEX idx_bills_date_status (document_date, status),
  INDEX idx_bills_project_company (project_id, company_id),
  INDEX idx_bills_vendor (vendor_name),
  INDEX idx_bills_source_user (source, source_user_id),
  INDEX idx_bills_duplicate (duplicate_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bill_items (
  item_id VARCHAR(64) PRIMARY KEY,
  bill_id VARCHAR(64) NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  description TEXT NOT NULL,
  quantity DECIMAL(15,4) NOT NULL DEFAULT 0,
  unit VARCHAR(80) NOT NULL DEFAULT '',
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  vat_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  sku VARCHAR(120) NOT NULL DEFAULT '',
  CONSTRAINT fk_bill_items_bill FOREIGN KEY (bill_id) REFERENCES bills(bill_id) ON DELETE CASCADE,
  INDEX idx_bill_items_bill_line (bill_id, line_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bill_documents (
  doc_id VARCHAR(64) PRIMARY KEY,
  bill_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL DEFAULT '',
  page_no SMALLINT UNSIGNED NOT NULL,
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
  CONSTRAINT fk_bill_documents_bill FOREIGN KEY (bill_id) REFERENCES bills(bill_id) ON DELETE CASCADE,
  UNIQUE KEY uq_bill_documents_page (bill_id, page_no),
  INDEX idx_bill_documents_sha (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage (
  usage_id VARCHAR(64) PRIMARY KEY,
  bill_id VARCHAR(64) NOT NULL DEFAULT '',
  model VARCHAR(120) NOT NULL,
  prompt_version VARCHAR(80) NOT NULL,
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  thought_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  total_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
  success TINYINT(1) NOT NULL DEFAULT 0,
  error TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_ai_usage_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  device_id VARCHAR(160) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_api_sessions_device (device_id),
  INDEX idx_api_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS protected_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  device_id VARCHAR(160) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_protected_sessions_device (device_id),
  INDEX idx_protected_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(160) NOT NULL,
  success TINYINT(1) NOT NULL,
  detail VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  INDEX idx_login_attempts_device_time (device_id, created_at),
  INDEX idx_login_attempts_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mutation_log (
  mutation_id VARCHAR(160) PRIMARY KEY,
  action VARCHAR(80) NOT NULL,
  actor VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL,
  result_json LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  INDEX idx_mutation_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id VARCHAR(64) PRIMARY KEY,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(80) NOT NULL,
  actor VARCHAR(160) NOT NULL,
  before_json LONGTEXT NULL,
  after_json LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_templates (
  template_id VARCHAR(64) PRIMARY KEY,
  template_name VARCHAR(255) NOT NULL,
  source_path VARCHAR(700) NOT NULL,
  normalized_path VARCHAR(700) NOT NULL,
  source_format VARCHAR(16) NOT NULL,
  page_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  placeholders JSON NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_receipt_templates_active (active, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS labor_groups (
  group_id VARCHAR(64) PRIMARY KEY,
  group_name VARCHAR(255) NOT NULL,
  group_type VARCHAR(80) NOT NULL DEFAULT 'SITE',
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_labor_groups_active_name (active, group_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workers (
  worker_id VARCHAR(64) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  first_name VARCHAR(160) NOT NULL DEFAULT '',
  last_name VARCHAR(160) NOT NULL DEFAULT '',
  national_id VARCHAR(20) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_workers_national_id (national_id),
  INDEX idx_workers_name (full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS worker_group_members (
  membership_id VARCHAR(64) PRIMARY KEY,
  worker_id VARCHAR(64) NOT NULL,
  group_id VARCHAR(64) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_members_worker FOREIGN KEY (worker_id) REFERENCES workers(worker_id) ON DELETE CASCADE,
  CONSTRAINT fk_members_group FOREIGN KEY (group_id) REFERENCES labor_groups(group_id) ON DELETE CASCADE,
  UNIQUE KEY uq_worker_group (worker_id, group_id),
  INDEX idx_members_group_active (group_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_batches (
  batch_id VARCHAR(64) PRIMARY KEY,
  template_id VARCHAR(64) NOT NULL,
  group_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  processed_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by VARCHAR(160) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_receipt_batches_group (group_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_registrations (
  registration_id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  worker_id VARCHAR(64) NOT NULL DEFAULT '',
  template_id VARCHAR(64) NOT NULL,
  group_id VARCHAR(64) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  first_name VARCHAR(160) NOT NULL DEFAULT '',
  last_name VARCHAR(160) NOT NULL DEFAULT '',
  national_id VARCHAR(20) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  card_path VARCHAR(700) NOT NULL,
  card_file_name VARCHAR(255) NOT NULL,
  card_sha256 CHAR(64) NOT NULL,
  card_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ocr_confidence DECIMAL(7,3) NOT NULL DEFAULT 0,
  ocr_warnings JSON NULL,
  duplicate_type VARCHAR(40) NOT NULL DEFAULT '',
  duplicate_of VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_receipt_reg_group_status (group_id, status),
  INDEX idx_receipt_reg_national (national_id),
  INDEX idx_receipt_reg_card_hash (card_sha256),
  INDEX idx_receipt_reg_name (full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS generated_documents (
  generated_id VARCHAR(64) PRIMARY KEY,
  format VARCHAR(16) NOT NULL,
  template_id VARCHAR(64) NOT NULL DEFAULT '',
  group_ids JSON NULL,
  registration_ids JSON NULL,
  person_count INT UNSIGNED NOT NULL DEFAULT 0,
  file_path VARCHAR(700) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  created_by VARCHAR(160) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  INDEX idx_generated_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS export_tickets (
  ticket VARCHAR(96) PRIMARY KEY,
  file_path VARCHAR(700) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  device_id VARCHAR(160) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_export_tickets_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, name) VALUES (1, 'initial_workhub_schema');
