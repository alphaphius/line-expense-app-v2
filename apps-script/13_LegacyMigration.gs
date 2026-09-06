function migrateLegacyTransactionsIfNeeded_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('LEGACY_TRANSACTIONS_MIGRATED_V1') === 'true') return;
  migrateLegacyTransactions();
  properties.setProperty('LEGACY_TRANSACTIONS_MIGRATED_V1', 'true');
}

function migrateLegacyTransactions() {
  const spreadsheet = getSpreadsheet_();
  const legacySheet = spreadsheet.getSheetByName('Transactions');
  if (!legacySheet || legacySheet.getLastRow() < 2) return { imported: 0, skipped: 0, message: 'ไม่พบข้อมูลเก่าใน Transactions' };
  const values = legacySheet.getDataRange().getValues();
  const headers = values.shift().map(String);
  const required = ['Timestamp', 'Project', 'Category', 'Vendor', 'TaxID', 'Date', 'Amount', 'Status', 'ImageURL', 'GeminiRaw', 'UserId'];
  if (required.some(function (header) { return headers.indexOf(header) < 0; })) {
    throw new Error('หัวคอลัมน์ Transactions รุ่นเดิมไม่ครบ ระบบจึงไม่ย้ายข้อมูลอัตโนมัติ');
  }
  const existingKeys = getRows_(SHEETS.BILLS).reduce(function (map, bill) { map[bill.duplicate_key] = true; return map; }, {});
  let imported = 0;
  let skipped = 0;
  values.forEach(function (row, index) {
    const legacy = {};
    headers.forEach(function (header, column) { legacy[header] = row[column]; });
    if (!row.some(function (value) { return cleanString_(value); })) return;
    const legacyKey = 'LEGACY_TRANSACTIONS_ROW_' + (index + 2);
    if (existingKeys[legacyKey]) { skipped += 1; return; }
    const projectId = findOrCreateLegacyMaster_('project', cleanString_(legacy.Project || 'โครงการทั่วไป'));
    const categoryId = findOrCreateLegacyMaster_('category', cleanString_(legacy.Category || 'อื่นๆ'));
    const timestamp = legacy.Timestamp instanceof Date
      ? Utilities.formatDate(legacy.Timestamp, APP_CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") : nowIso_();
    const userValue = cleanString_(legacy.UserId);
    const username = /^U[a-f0-9]{20,}$/i.test(userValue) ? getLineDisplayName_(userValue) : (userValue || 'Legacy Import');
    const statusText = cleanString_(legacy.Status).toLowerCase();
    const status = /confirm|ยืนยัน|complete|เสร็จ/.test(statusText) ? 'CONFIRMED' : 'NEEDS_REVIEW';
    const bill = {
      bill_id: uuid_(), session_id: '', project_id: projectId, company_id: '', category_id: categoryId,
      doc_type: 'OTHER', document_no: '', document_date: parseLegacyDate_(legacy.Date), due_date: '', vendor_id: '',
      vendor_name: cleanString_(legacy.Vendor, 200), vendor_tax_id: normalizeTaxId_(legacy.TaxID), vendor_branch: '', vendor_address: '',
      buyer_name: '', buyer_tax_id: '', buyer_address: '', currency: 'THB', subtotal: toNumber_(legacy.Amount), discount: 0,
      vat_rate: 0, vat_amount: 0, withholding_tax: 0, grand_total: toNumber_(legacy.Amount), payment_method: '',
      description: 'นำเข้าจาก Transactions รุ่นเดิม', notes: cleanString_(legacy.GeminiRaw, 1000), page_count: 1,
      image_quality: '', quality_score: 0, needs_review: status !== 'CONFIRMED',
      review_reasons: status !== 'CONFIRMED' ? 'ข้อมูลนำเข้าจากระบบเดิม กรุณาตรวจสอบ' : '',
      company_match: false, tax_id_match: false, duplicate_key: legacyKey, status: status, source: 'LINE',
      source_user_id: username, folder_path: cleanString_(legacy.ImageURL, 500), created_at: timestamp,
      updated_at: timestamp, confirmed_at: status === 'CONFIRMED' ? timestamp : '', address_match: false,
    };
    appendObject_(SHEETS.BILLS, bill);
    existingKeys[legacyKey] = true;
    imported += 1;
  });
  return { imported: imported, skipped: skipped, message: 'นำเข้าข้อมูลเก่า ' + imported + ' รายการ ข้ามข้อมูลซ้ำ ' + skipped + ' รายการ' };
}

function findOrCreateLegacyMaster_(type, name) {
  const map = type === 'project'
    ? { sheet: SHEETS.PROJECTS, id: 'project_id', name: 'project_name' }
    : { sheet: SHEETS.CATEGORIES, id: 'category_id', name: 'category_name' };
  const normalized = normalizeThaiText_(name);
  const existing = getRows_(map.sheet).find(function (row) { return normalizeThaiText_(row[map.name]) === normalized; });
  if (existing) return existing[map.id];
  const timestamp = nowIso_();
  const object = { active: true, created_at: timestamp, updated_at: timestamp };
  object[map.id] = uuid_();
  object[map.name] = name;
  if (type === 'project') { object.project_code = 'LEGACY'; object.description = 'นำเข้าจากระบบเดิม'; }
  else object.aliases = name;
  appendObject_(map.sheet, object);
  return object[map.id];
}

function parseLegacyDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const text = cleanString_(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return toIsoDate_(text);
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return '';
  let year = Number(match[3]);
  if (year > 2400) year -= 543;
  return toIsoDate_([year, String(match[2]).padStart(2, '0'), String(match[1]).padStart(2, '0')].join('-'));
}

function linkLegacyImagesIfNeeded_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('LEGACY_IMAGES_LINKED_V1') === 'true') return;
  const documents = getRows_(SHEETS.DOCUMENTS);
  const billsWithDocuments = documents.reduce(function (map, document) { map[document.bill_id] = true; return map; }, {});
  getRows_(SHEETS.BILLS).forEach(function (bill) {
    const imageUrl = cleanString_(bill.folder_path);
    if (!/^LEGACY_TRANSACTIONS_ROW_/.test(bill.duplicate_key) || !/^https?:\/\//i.test(imageUrl) || billsWithDocuments[bill.bill_id]) return;
    const match = imageUrl.match(/\/d\/([^/?]+)/) || imageUrl.match(/[?&]id=([^&]+)/);
    const fileId = match ? match[1] : '';
    appendObject_(SHEETS.DOCUMENTS, {
      doc_id: uuid_(), bill_id: bill.bill_id, session_id: '', page_no: 1, file_id: fileId,
      file_name: 'legacy-bill-image', mime_type: '', file_url: imageUrl, sha256: '', size_bytes: '', created_at: bill.created_at || nowIso_(),
    });
    billsWithDocuments[bill.bill_id] = true;
  });
  properties.setProperty('LEGACY_IMAGES_LINKED_V1', 'true');
}
