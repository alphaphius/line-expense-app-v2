const RECEIPT_PLACEHOLDERS = Object.freeze(['{ชื่อสกุล}', '{เลขบัตร}', '{ที่อยู่}']);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function getReceiptWorkspace(filters) {
  setupIfNeeded_();
  const enabled = isReceiptModuleEnabled_();
  if (!enabled) {
    return ok_({
      enabled: false,
      securityMessage: 'ยังไม่ได้ตั้งค่ารหัสส่วนงานภายในหรือยังไม่ได้เปิดโมดูล กรุณาติดต่อผู้ดูแลระบบ',
      templates: [], groups: [], projects: [], registrations: [],
    });
  }
  ensureDefaultLaborGroup_();
  const registrationResult = listReceiptRegistrations(filters || {});
  if (!registrationResult.ok) return registrationResult;
  return ok_({
    enabled: true,
    templates: publicRows_(SHEETS.RECEIPT_TEMPLATES).filter(function (row) { return toBoolean_(row.active); }),
    groups: receiptGroupsWithProjects_(),
    projects: publicRows_(SHEETS.PROJECTS).filter(function (row) { return toBoolean_(row.active); }),
    registrations: registrationResult.data,
  });
}

function saveLaborGroup(payload) {
  assertReceiptModuleEnabled_();
  payload = payload || {};
  const name = cleanString_(payload.group_name, 150);
  const type = cleanString_(payload.group_type, 20).toUpperCase();
  const projectId = cleanString_(payload.project_id, 100);
  if (!name) throw apiError_('GROUP_NAME_REQUIRED', 'กรุณาระบุชื่อกลุ่มแรงงาน');
  if (['PERMANENT', 'SITE', 'OTHER'].indexOf(type) < 0) throw apiError_('INVALID_GROUP_TYPE', 'ประเภทกลุ่มแรงงานไม่ถูกต้อง');
  if (type === 'SITE' && (!projectId || !findById_(SHEETS.PROJECTS, 'project_id', projectId))) {
    throw apiError_('PROJECT_REQUIRED', 'กลุ่มไซต์งานต้องเลือกโครงการ');
  }
  const duplicate = publicRows_(SHEETS.LABOR_GROUPS).some(function (row) {
    return toBoolean_(row.active) && normalizeThaiText_(row.group_name) === normalizeThaiText_(name) && cleanString_(row.group_id) !== cleanString_(payload.group_id);
  });
  if (duplicate) throw apiError_('DUPLICATE_GROUP', 'มีชื่อกลุ่มนี้แล้ว');
  const now = nowIso_();
  const id = cleanString_(payload.group_id, 100);
  const patch = { group_name: name, group_type: type, project_id: type === 'SITE' ? projectId : '', active: true, updated_at: now };
  const result = id
    ? updateObjectById_(SHEETS.LABOR_GROUPS, 'group_id', id, patch)
    : appendObject_(SHEETS.LABOR_GROUPS, Object.assign({ group_id: uuid_(), created_at: now }, patch));
  return ok_(receiptGroupWithProject_(result));
}

function saveReceiptTemplate(payload) {
  assertReceiptModuleEnabled_();
  payload = payload || {};
  const name = cleanString_(payload.template_name || payload.file_name, 150).replace(/\.(docx?|DOCX?)$/, '');
  const fileName = cleanString_(payload.file_name, 180);
  const extension = (fileName.match(/\.([^.]+)$/) || [])[1];
  if (!name) throw apiError_('TEMPLATE_NAME_REQUIRED', 'กรุณาระบุชื่อ Template');
  if (!/^(doc|docx)$/i.test(extension || '')) throw apiError_('TEMPLATE_FORMAT', 'รองรับ Template เฉพาะไฟล์ DOC และ DOCX');
  const parsed = parseReceiptTemplateDataUrl_(payload.data_url, extension);
  const templateRoot = getOrCreateChildFolder_(getRootFolder_(), 'receipt-templates');
  const sourceBlob = Utilities.newBlob(parsed.bytes, parsed.mimeType, sanitizeReceiptFileName_(fileName));
  const sourceFile = templateRoot.createFile(sourceBlob);
  let normalizedFile = sourceFile;
  try {
    if (extension.toLowerCase() === 'doc') {
      normalizedFile = convertLegacyDocToDocx_(sourceBlob, name, templateRoot);
    }
    const validation = inspectReceiptTemplateDocx_(normalizedFile.getBlob());
    const now = nowIso_();
    const record = appendObject_(SHEETS.RECEIPT_TEMPLATES, {
      template_id: uuid_(), template_name: name, source_file_id: sourceFile.getId(), normalized_file_id: normalizedFile.getId(),
      source_format: extension.toUpperCase(), page_count: validation.pageCount, placeholders: validation.placeholders.join(','),
      active: true, created_at: now, updated_at: now,
    });
    return ok_(record);
  } catch (error) {
    try { sourceFile.setTrashed(true); } catch (ignored) {}
    if (normalizedFile && normalizedFile.getId() !== sourceFile.getId()) {
      try { normalizedFile.setTrashed(true); } catch (ignoredToo) {}
    }
    throw error;
  }
}

function createReceiptBatch(payload) {
  assertReceiptModuleEnabled_();
  payload = payload || {};
  const templateId = cleanString_(payload.template_id, 100);
  const groupId = cleanString_(payload.group_id, 100);
  const total = Math.trunc(toNumber_(payload.total_count));
  if (!findById_(SHEETS.RECEIPT_TEMPLATES, 'template_id', templateId)) throw apiError_('TEMPLATE_REQUIRED', 'กรุณาเลือก Template');
  if (!findById_(SHEETS.LABOR_GROUPS, 'group_id', groupId)) throw apiError_('GROUP_REQUIRED', 'กรุณาเลือกกลุ่มแรงงาน');
  if (total < 1 || total > APP_CONFIG.RECEIPT_MAX_BATCH_CARDS) throw apiError_('BATCH_SIZE', 'อัปโหลดได้ครั้งละ 1-' + APP_CONFIG.RECEIPT_MAX_BATCH_CARDS + ' รูป');
  const now = nowIso_();
  return ok_(appendObject_(SHEETS.RECEIPT_BATCHES, {
    batch_id: uuid_(), template_id: templateId, group_id: groupId, status: 'PROCESSING', total_count: total,
    processed_count: 0, error_count: 0, created_by: cleanString_(payload.created_by || 'WEB', 100), created_at: now, updated_at: now,
  }));
}

function saveReceiptCardDraft(payload) {
  assertReceiptModuleEnabled_();
  payload = payload || {};
  const batch = findById_(SHEETS.RECEIPT_BATCHES, 'batch_id', cleanString_(payload.batch_id, 100));
  if (!batch) throw apiError_('BATCH_NOT_FOUND', 'ไม่พบชุดอัปโหลด');
  const parsed = parseReceiptCardDataUrl_(payload.data_url);
  const digest = sha256BytesHex_(parsed.bytes);
  const safeName = sanitizeReceiptFileName_(cleanString_(payload.file_name, 150) || 'id-card.jpg');
  const folder = getReceiptCardFolder_();
  const file = folder.createFile(Utilities.newBlob(parsed.bytes, parsed.mimeType, safeName));
  try {
    const ocr = sanitizeClientReceiptOcr_(payload.ocr);
    const duplicate = findReceiptDuplicate_(ocr.national_id, digest, ocr.full_name, ocr.address, '');
    const now = nowIso_();
    const record = appendObject_(SHEETS.RECEIPT_REGISTRATIONS, {
      registration_id: uuid_(), batch_id: batch.batch_id, worker_id: '', template_id: batch.template_id, group_id: batch.group_id,
      full_name: ocr.full_name, first_name: ocr.first_name, last_name: ocr.last_name, national_id: ocr.national_id, address: ocr.address,
      card_file_id: file.getId(), card_file_name: safeName, card_sha256: digest, card_size_bytes: parsed.bytes.length,
      ocr_confidence: ocr.confidence, ocr_warnings: (ocr.warnings || []).join(' | '),
      duplicate_type: duplicate.type, duplicate_of: duplicate.registrationId, status: 'OCR_READY', created_at: now, updated_at: now,
    });
    updateReceiptBatchCounts_(batch.batch_id, false);
    return ok_(receiptRegistrationForClient_(record, true));
  } catch (error) {
    updateReceiptBatchCounts_(batch.batch_id, true);
    try { file.setTrashed(true); } catch (ignored) {}
    throw error;
  }
}

function sanitizeClientReceiptOcr_(value) {
  const input = value && typeof value === 'object' ? value : {};
  const fullName = cleanString_(input.full_name, 200).replace(/^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง)\s*/, '').replace(/\s+/g, ' ');
  const split = splitThaiFullName_(fullName);
  const nationalId = normalizeNationalId_(input.national_id);
  const address = cleanString_(input.address, 700).replace(/\s+/g, ' ');
  const warnings = (Array.isArray(input.warnings) ? input.warnings : []).slice(0, 8).map(function (warning) {
    return cleanString_(warning, 180);
  }).filter(Boolean);
  if (nationalId && !isValidThaiNationalId_(nationalId) && warnings.indexOf('เลขบัตรไม่ผ่าน checksum กรุณาตรวจสอบ') < 0) {
    warnings.push('เลขบัตรไม่ผ่าน checksum กรุณาตรวจสอบ');
  }
  if (!fullName || !nationalId || !address) warnings.push('OCR อ่านข้อมูลไม่ครบ กรุณาตรวจสอบและแก้ไขก่อนบันทึก');
  return {
    full_name: fullName,
    first_name: cleanString_(input.first_name, 100) || split.firstName,
    last_name: cleanString_(input.last_name, 100) || split.lastName,
    national_id: nationalId,
    address: address,
    confidence: Math.max(0, Math.min(100, toNumber_(input.confidence))),
    warnings: warnings,
  };
}

function saveReceiptRegistrations(payload) {
  assertReceiptModuleEnabled_();
  payload = payload || {};
  const batchId = cleanString_(payload.batch_id, 100);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!batchId || !rows.length) throw apiError_('REGISTRATIONS_REQUIRED', 'ไม่พบรายการที่ต้องการบันทึก');
  if (rows.length > APP_CONFIG.RECEIPT_MAX_BATCH_CARDS) throw apiError_('BATCH_SIZE', 'จำนวนรายการเกินขีดจำกัด');
  return ok_(withScriptLock_(function () {
    const prepared = rows.map(function (input) {
      const current = findById_(SHEETS.RECEIPT_REGISTRATIONS, 'registration_id', cleanString_(input.registration_id, 100));
      if (!current || current.batch_id !== batchId) throw apiError_('REGISTRATION_NOT_FOUND', 'ไม่พบรายการ OCR ที่ต้องการบันทึก');
      const fullName = cleanString_(input.full_name, 200).replace(/\s+/g, ' ');
      const nameParts = splitThaiFullName_(fullName);
      const nationalId = normalizeNationalId_(input.national_id);
      const address = cleanString_(input.address, 700).replace(/\s+/g, ' ');
      if (!fullName || !nationalId || !address) throw apiError_('REQUIRED_FIELDS', 'กรุณากรอกชื่อ เลขบัตร และที่อยู่ให้ครบ');
      if (!isValidThaiNationalId_(nationalId)) throw apiError_('INVALID_NATIONAL_ID', 'เลขบัตรประชาชนของ ' + fullName + ' ไม่ถูกต้อง');
      const duplicate = findReceiptDuplicate_(nationalId, current.card_sha256, fullName, address, current.registration_id);
      const allowExisting = toBoolean_(input.allow_existing_worker);
      if ((duplicate.type === 'NATIONAL_ID' || duplicate.type === 'IMAGE') && !allowExisting) {
        throw apiError_('DUPLICATE_REGISTRATION', fullName + ' มีข้อมูลซ้ำในระบบ กรุณาตรวจสอบและเลือกเชื่อมกับบุคคลเดิม');
      }
      const existingWorker = duplicate.workerId ? findById_(SHEETS.WORKERS, 'worker_id', duplicate.workerId) : findWorkerByNationalId_(nationalId);
      return { current: current, fullName: fullName, nameParts: nameParts, nationalId: nationalId, address: address, duplicate: duplicate, existingWorker: existingWorker };
    });
    const saved = [];
    prepared.forEach(function (item) {
      const now = nowIso_();
      let worker;
      if (item.existingWorker) {
        worker = updateObjectById_(SHEETS.WORKERS, 'worker_id', item.existingWorker.worker_id, {
          full_name: item.fullName, first_name: item.nameParts.firstName, last_name: item.nameParts.lastName, national_id: item.nationalId,
          address: item.address, status: 'ACTIVE', updated_at: now,
        });
      } else {
        worker = appendObject_(SHEETS.WORKERS, {
          worker_id: uuid_(), full_name: item.fullName, first_name: item.nameParts.firstName, last_name: item.nameParts.lastName,
          national_id: item.nationalId, address: item.address, status: 'ACTIVE', created_at: now, updated_at: now,
        });
      }
      ensureWorkerGroupMembership_(worker.worker_id, item.current.group_id);
      const updated = updateObjectById_(SHEETS.RECEIPT_REGISTRATIONS, 'registration_id', item.current.registration_id, {
        worker_id: worker.worker_id, full_name: item.fullName, first_name: item.nameParts.firstName, last_name: item.nameParts.lastName,
        national_id: item.nationalId, address: item.address, duplicate_type: item.duplicate.type, duplicate_of: item.duplicate.registrationId,
        status: 'SAVED', updated_at: now,
      });
      saved.push(receiptRegistrationForClient_(updated));
    });
    updateObjectById_(SHEETS.RECEIPT_BATCHES, 'batch_id', batchId, { status: 'COMPLETED', updated_at: nowIso_() });
    return { saved: saved, count: saved.length };
  }));
}

function listReceiptRegistrations(filters) {
  assertReceiptModuleEnabled_();
  filters = filters || {};
  const search = normalizeThaiText_(filters.search);
  const groupIds = arrayOfCleanStrings_(filters.group_ids || (filters.group_id ? [filters.group_id] : []));
  const status = cleanString_(filters.status, 30);
  let rows = publicRows_(SHEETS.RECEIPT_REGISTRATIONS).filter(function (row) {
    if (groupIds.length && groupIds.indexOf(cleanString_(row.group_id)) < 0) return false;
    if (status && row.status !== status) return false;
    if (search) {
      const haystack = normalizeThaiText_([row.full_name, row.national_id, row.address].join(' '));
      if (haystack.indexOf(search) < 0) return false;
    }
    return true;
  });
  rows.sort(function (a, b) { return cleanString_(b.updated_at).localeCompare(cleanString_(a.updated_at)); });
  rows = rows.slice(0, 500).map(receiptRegistrationForClient_);
  return ok_({ rows: rows, total: rows.length });
}

function previewReceiptExport(payload) {
  assertReceiptModuleEnabled_();
  const selection = resolveReceiptExportSelection_(payload || {}, 5000);
  const groupMap = receiptGroupsWithProjects_().reduce(function (map, group) { map[group.group_id] = group; return map; }, {});
  const groupedMap = {};
  selection.rows.forEach(function (row) {
    const group = groupMap[row.group_id] || { group_id: row.group_id, group_name: 'ไม่ระบุกลุ่ม', site_name: '' };
    if (!groupedMap[group.group_id]) groupedMap[group.group_id] = { group_id: group.group_id, group_name: group.group_name, site_name: group.site_name || '', people: [] };
    groupedMap[group.group_id].people.push({ registration_id: row.registration_id, full_name: row.full_name, national_id_masked: maskNationalId_(row.national_id) });
  });
  return ok_({ total: selection.rows.length, groups: Object.keys(groupedMap).map(function (key) { return groupedMap[key]; }) });
}

function receiptGroupsWithProjects_() {
  const projects = publicRows_(SHEETS.PROJECTS).reduce(function (map, project) { map[project.project_id] = project; return map; }, {});
  return publicRows_(SHEETS.LABOR_GROUPS).filter(function (row) { return toBoolean_(row.active); }).map(function (row) {
    return receiptGroupWithProject_(row, projects);
  });
}

function receiptGroupWithProject_(row, projectMap) {
  const projects = projectMap || publicRows_(SHEETS.PROJECTS).reduce(function (map, project) { map[project.project_id] = project; return map; }, {});
  return Object.assign({}, row, { site_name: projects[row.project_id] ? projects[row.project_id].project_name : '' });
}

function ensureDefaultLaborGroup_() {
  if (publicRows_(SHEETS.LABOR_GROUPS).some(function (row) { return toBoolean_(row.active); })) return;
  const now = nowIso_();
  appendObject_(SHEETS.LABOR_GROUPS, { group_id: uuid_(), group_name: 'แรงงานประจำ', group_type: 'PERMANENT', project_id: '', active: true, created_at: now, updated_at: now });
}

function isReceiptModuleEnabled_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_KEYS.RECEIPT_MODULE_ENABLED) === 'true' && isProtectedAccessConfigured_();
}

function assertReceiptModuleEnabled_() {
  setupIfNeeded_();
  if (!isReceiptModuleEnabled_()) throw apiError_('RECEIPT_MODULE_DISABLED', 'โมดูลเอกสารใบรับเงินยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
}

function parseReceiptTemplateDataUrl_(dataUrl, extension) {
  const match = cleanString_(dataUrl).match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw apiError_('TEMPLATE_FILE', 'ไฟล์ Template ไม่ถูกต้อง');
  const bytes = Utilities.base64Decode(match[2].replace(/\s/g, ''));
  if (bytes.length > APP_CONFIG.RECEIPT_MAX_TEMPLATE_MB * 1024 * 1024) throw apiError_('TEMPLATE_TOO_LARGE', 'Template ต้องมีขนาดไม่เกิน ' + APP_CONFIG.RECEIPT_MAX_TEMPLATE_MB + ' MB');
  return { bytes: bytes, mimeType: extension.toLowerCase() === 'doc' ? 'application/msword' : DOCX_MIME };
}

function parseReceiptCardDataUrl_(dataUrl) {
  const parsed = parseDataUrl_(dataUrl);
  if (!/^image\/(jpeg|png|webp)$/i.test(parsed.mimeType)) throw apiError_('CARD_IMAGE_FORMAT', 'รูปบัตรรองรับเฉพาะ JPG, PNG และ WEBP');
  return parsed;
}

function getReceiptCardFolder_() {
  const root = getOrCreateChildFolder_(getRootFolder_(), 'receipt-cards');
  return getOrCreateChildFolder_(root, todayIso_().slice(0, 7));
}

function sanitizeReceiptFileName_(value) {
  return cleanString_(value, 180).replace(/[^0-9A-Za-zก-๙._() -]/g, '_') || 'document';
}

function sha256BytesHex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function normalizeNationalId_(value) {
  return cleanString_(value).replace(/\D/g, '').slice(0, 13);
}

function isValidThaiNationalId_(value) {
  const id = normalizeNationalId_(value);
  if (!/^\d{13}$/.test(id) || /^(\d)\1{12}$/.test(id)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(id.charAt(index)) * (13 - index);
  return (11 - (sum % 11)) % 10 === Number(id.charAt(12));
}

function maskNationalId_(value) {
  const id = normalizeNationalId_(value);
  return id.length === 13 ? id.slice(0, 1) + '-XXXX-XXXXX-' + id.slice(11) : '';
}

function splitThaiFullName_(value) {
  const parts = cleanString_(value, 200).replace(/^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง)\s*/, '').split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
}

function findWorkerByNationalId_(nationalId) {
  const id = normalizeNationalId_(nationalId);
  return getRows_(SHEETS.WORKERS).filter(function (row) { return normalizeNationalId_(row.national_id) === id; })[0] || null;
}

function findReceiptDuplicate_(nationalId, sha256, fullName, address, excludeRegistrationId) {
  const id = normalizeNationalId_(nationalId);
  const hash = cleanString_(sha256, 100);
  const nameKey = normalizeThaiText_(fullName);
  const addressKey = normalizeAddress_(address);
  const rows = getRows_(SHEETS.RECEIPT_REGISTRATIONS).filter(function (row) { return row.registration_id !== excludeRegistrationId && row.status !== 'REJECTED'; });
  let match = rows.filter(function (row) { return id && normalizeNationalId_(row.national_id) === id; })[0];
  if (match) return { type: 'NATIONAL_ID', registrationId: match.registration_id, workerId: match.worker_id || '' };
  const workerMatch = id ? findWorkerByNationalId_(id) : null;
  if (workerMatch) return { type: 'NATIONAL_ID', registrationId: '', workerId: workerMatch.worker_id };
  match = rows.filter(function (row) { return hash && cleanString_(row.card_sha256) === hash; })[0];
  if (match) return { type: 'IMAGE', registrationId: match.registration_id, workerId: match.worker_id || '' };
  match = rows.filter(function (row) { return nameKey && addressKey && normalizeThaiText_(row.full_name) === nameKey && normalizeAddress_(row.address) === addressKey; })[0];
  if (match) return { type: 'NAME_ADDRESS', registrationId: match.registration_id, workerId: match.worker_id || '' };
  return { type: '', registrationId: '', workerId: '' };
}

function ensureWorkerGroupMembership_(workerId, groupId) {
  const exists = getRows_(SHEETS.WORKER_GROUP_MEMBERS).some(function (row) { return row.worker_id === workerId && row.group_id === groupId && toBoolean_(row.active); });
  if (exists) return;
  const now = nowIso_();
  appendObject_(SHEETS.WORKER_GROUP_MEMBERS, { membership_id: uuid_(), worker_id: workerId, group_id: groupId, active: true, created_at: now, updated_at: now });
}

function updateReceiptBatchCounts_(batchId, failed) {
  try {
    const batch = findById_(SHEETS.RECEIPT_BATCHES, 'batch_id', batchId);
    if (!batch) return;
    const processed = toNumber_(batch.processed_count) + (failed ? 0 : 1);
    const errors = toNumber_(batch.error_count) + (failed ? 1 : 0);
    const done = processed + errors >= toNumber_(batch.total_count);
    updateObjectById_(SHEETS.RECEIPT_BATCHES, 'batch_id', batchId, {
      processed_count: processed, error_count: errors, status: done ? (errors ? 'NEEDS_REVIEW' : 'OCR_READY') : 'PROCESSING', updated_at: nowIso_(),
    });
  } catch (error) { console.error('Receipt batch counter: ' + error.message); }
}

function receiptRegistrationForClient_(row, revealSensitive) {
  const result = Object.assign({}, row, { national_id_masked: maskNationalId_(row.national_id) });
  if (!revealSensitive && row.status === 'SAVED') {
    delete result.national_id;
    delete result.address;
    delete result.card_file_id;
    delete result.card_sha256;
  }
  return result;
}

function arrayOfCleanStrings_(value) {
  return (Array.isArray(value) ? value : []).map(function (item) { return cleanString_(item, 100); }).filter(Boolean);
}

function resolveReceiptExportSelection_(payload, maximumPeople) {
  const registrationIds = arrayOfCleanStrings_(payload.registration_ids);
  const groupIds = arrayOfCleanStrings_(payload.group_ids);
  let rows = publicRows_(SHEETS.RECEIPT_REGISTRATIONS).filter(function (row) { return row.status === 'SAVED'; });
  if (registrationIds.length) rows = rows.filter(function (row) { return registrationIds.indexOf(row.registration_id) >= 0; });
  else if (groupIds.length) rows = rows.filter(function (row) { return groupIds.indexOf(row.group_id) >= 0; });
  else throw apiError_('EXPORT_SELECTION_REQUIRED', 'กรุณาเลือกรายชื่อหรือกลุ่มที่ต้องการ Export');
  if (!rows.length) throw apiError_('EXPORT_EMPTY', 'ไม่พบรายชื่อที่พร้อม Export');
  const maximum = Math.max(1, Number(maximumPeople) || APP_CONFIG.RECEIPT_MAX_EXPORT_PEOPLE);
  if (rows.length > maximum) throw apiError_('EXPORT_TOO_LARGE', 'รายการที่เลือกเกินขีดจำกัด ' + maximum + ' คนต่อครั้ง');
  rows.sort(function (a, b) { return cleanString_(a.group_id).localeCompare(cleanString_(b.group_id)) || cleanString_(a.full_name).localeCompare(cleanString_(b.full_name), 'th'); });
  return { rows: rows };
}

function exportReceiptDocuments(payload) {
  assertReceiptModuleEnabled_();
  payload = payload || {};
  const selection = resolveReceiptExportSelection_(payload, APP_CONFIG.RECEIPT_MAX_EXPORT_PEOPLE);
  const templateId = cleanString_(payload.template_id, 100) || cleanString_(selection.rows[0].template_id, 100);
  const template = findById_(SHEETS.RECEIPT_TEMPLATES, 'template_id', templateId);
  if (!template || !toBoolean_(template.active)) throw apiError_('TEMPLATE_NOT_FOUND', 'ไม่พบ Template ที่เลือก');
  const mixedTemplate = selection.rows.some(function (row) { return row.template_id !== templateId; });
  if (mixedTemplate && !toBoolean_(payload.force_template)) throw apiError_('MIXED_TEMPLATES', 'รายการที่เลือกใช้หลาย Template กรุณาเลือก Template ที่จะใช้ Export');
  const templateBlob = DriveApp.getFileById(template.normalized_file_id).getBlob();
  const fileBase = 'ใบรับเงิน_' + todayIso_() + '_' + selection.rows.length + 'คน';
  const outputBlob = buildReceiptDocx_(templateBlob, selection.rows, fileBase);
  const result = buildExportResult_(outputBlob, fileBase + '.docx', DOCX_MIME, selection.rows.length, todayIso_().slice(0, 7));
  appendGeneratedDocument_(result, 'DOCX', templateId, selection.rows, payload);
  return ok_(result);
}

function exportReceiptRosterExcel(payload) {
  assertReceiptModuleEnabled_();
  payload = payload || {};
  const selection = resolveReceiptExportSelection_(payload, 5000);
  let temporarySpreadsheet = null;
  try {
    const groupMap = receiptGroupsWithProjects_().reduce(function (map, group) { map[group.group_id] = group; return map; }, {});
    const fileBase = 'รายชื่อใบรับเงิน_' + todayIso_() + '_' + selection.rows.length + 'คน';
    temporarySpreadsheet = SpreadsheetApp.create(fileBase);
    const sheet = temporarySpreadsheet.getSheets()[0];
    sheet.setName('รายชื่อแรงงาน');
    const headers = ['ลำดับ', 'รหัสบุคคล', 'ชื่อ-นามสกุล', 'เลขบัตรประชาชน', 'ที่อยู่', 'กลุ่มแรงงาน', 'ไซต์งาน', 'วันที่บันทึก'];
    const values = selection.rows.map(function (row, index) {
      const group = groupMap[row.group_id] || {};
      return [index + 1, row.worker_id, row.full_name, row.national_id, row.address, group.group_name || '', group.site_name || '', row.updated_at];
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground('#2D211C').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.getRange(2, 1, values.length, headers.length).setValues(values).setWrap(true).setVerticalAlignment('top');
    sheet.getRange(2, 4, values.length, 1).setNumberFormat('@');
    sheet.setFrozenRows(1);
    [65, 250, 220, 150, 420, 180, 200, 190].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
    SpreadsheetApp.flush();
    const response = exportGoogleFile_('https://docs.google.com/spreadsheets/d/' + temporarySpreadsheet.getId() + '/export?format=xlsx');
    const result = buildExportResult_(response.getBlob(), fileBase + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', selection.rows.length, todayIso_().slice(0, 7));
    appendGeneratedDocument_(result, 'XLSX', '', selection.rows, payload);
    return ok_(result);
  } finally {
    if (temporarySpreadsheet) {
      try { DriveApp.getFileById(temporarySpreadsheet.getId()).setTrashed(true); } catch (ignored) {}
    }
  }
}

function appendGeneratedDocument_(result, format, templateId, rows, payload) {
  appendObject_(SHEETS.GENERATED_DOCUMENTS, {
    generated_id: uuid_(), format: format, template_id: templateId,
    group_ids: arrayOfCleanStrings_(payload.group_ids).join(','),
    registration_ids: rows.map(function (row) { return row.registration_id; }).join(','),
    person_count: rows.length, file_id: cleanString_(result.fileId), file_name: cleanString_(result.fileName),
    created_by: cleanString_(payload.created_by || 'WEB', 100), created_at: nowIso_(),
  });
}

function inspectReceiptTemplateDocx_(blob) {
  let parts;
  try { parts = Utilities.unzip(blob); }
  catch (error) { throw apiError_('INVALID_DOCX', 'เปิดโครงสร้าง DOCX ไม่สำเร็จ กรุณาตรวจว่าไฟล์ไม่เสียหายหรือมีรหัสผ่าน'); }
  const documentPart = parts.filter(function (part) { return part.getName() === 'word/document.xml'; })[0];
  if (!documentPart) throw apiError_('INVALID_DOCX', 'ไม่พบเนื้อหาเอกสารใน DOCX');
  const xml = documentPart.getDataAsString('UTF-8');
  const text = docxPlainText_(xml);
  const placeholders = RECEIPT_PLACEHOLDERS.filter(function (placeholder) { return text.indexOf(placeholder) >= 0; });
  const missing = RECEIPT_PLACEHOLDERS.filter(function (placeholder) { return placeholders.indexOf(placeholder) < 0; });
  if (missing.length) throw apiError_('MISSING_PLACEHOLDERS', 'Template ขาด Placeholder: ' + missing.join(', '));
  const pageBreaks = (xml.match(/<w:br\b[^>]*w:type=["']page["'][^>]*\/>/g) || []).length;
  return { placeholders: placeholders, pageCount: Math.max(1, pageBreaks + 1) };
}

function buildReceiptDocx_(templateBlob, registrations, fileBase) {
  inspectReceiptTemplateDocx_(templateBlob);
  const parts = Utilities.unzip(templateBlob);
  const map = {};
  parts.forEach(function (part) { map[part.getName()] = part; });
  let documentXml = map['word/document.xml'].getDataAsString('UTF-8');
  const bodyMatch = documentXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) throw apiError_('INVALID_DOCX', 'โครงสร้างเนื้อหา DOCX ไม่ถูกต้อง');
  const bodyXml = bodyMatch[1];
  const sectionMatch = bodyXml.match(/(<w:sectPr\b[\s\S]*?<\/w:sectPr>)\s*$/);
  const sectionXml = sectionMatch ? sectionMatch[1] : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>';
  const templateBody = sectionMatch ? bodyXml.slice(0, sectionMatch.index) : bodyXml;
  let relationshipsXml = map['word/_rels/document.xml.rels']
    ? map['word/_rels/document.xml.rels'].getDataAsString('UTF-8')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let contentTypesXml = map['[Content_Types].xml'].getDataAsString('UTF-8');
  if (!/Extension=["']jpg["']/i.test(contentTypesXml)) {
    contentTypesXml = contentTypesXml.replace('</Types>', '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
  }
  let nextRel = nextDocxRelationshipNumber_(relationshipsXml);
  let nextDrawing = nextDocxDrawingNumber_(documentXml);
  const generatedImageParts = [];
  const outputBodies = [];
  registrations.forEach(function (row, index) {
    let personBody = replaceDocxPlaceholders_(templateBody, {
      '{ชื่อสกุล}': cleanString_(row.full_name, 200),
      '{เลขบัตร}': normalizeNationalId_(row.national_id),
      '{ที่อยู่}': cleanString_(row.address, 700),
    });
    outputBodies.push(personBody);
    outputBodies.push(docxPageBreak_());
    const sourceFile = DriveApp.getFileById(row.card_file_id);
    const imageBlob = getReceiptExportImageBlob_(sourceFile);
    const bytes = imageBlob.getBytes();
    const relationshipId = 'rId' + nextRel++;
    const partName = 'receipt-card-' + (index + 1) + '.jpg';
    relationshipsXml = relationshipsXml.replace('</Relationships>', '<Relationship Id="' + relationshipId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + partName + '"/></Relationships>');
    generatedImageParts.push(Utilities.newBlob(bytes, 'image/jpeg', 'word/media/' + partName));
    const dimensions = readImageDimensions_(bytes, 'jpg');
    const fitted = fitDocxImage_({ width: dimensions.width, height: dimensions.height }, 6.7, 9.25);
    outputBodies.push(docxImageParagraph_({ relationshipId: relationshipId, drawingId: nextDrawing++, name: cleanString_(row.full_name) + ' ID card' }, fitted.width, fitted.height));
    if (index < registrations.length - 1) outputBodies.push(docxPageBreak_());
  });
  documentXml = documentXml.replace(bodyMatch[0], '<w:body>' + outputBodies.join('') + sectionXml + '</w:body>');
  const outputParts = parts.filter(function (part) {
    return ['word/document.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml'].indexOf(part.getName()) < 0;
  });
  outputParts.push(Utilities.newBlob(documentXml, 'application/xml', 'word/document.xml'));
  outputParts.push(Utilities.newBlob(relationshipsXml, 'application/vnd.openxmlformats-package.relationships+xml', 'word/_rels/document.xml.rels'));
  outputParts.push(Utilities.newBlob(contentTypesXml, 'application/xml', '[Content_Types].xml'));
  Array.prototype.push.apply(outputParts, generatedImageParts);
  return Utilities.zip(outputParts, fileBase + '.docx').setContentType(DOCX_MIME);
}

function replaceDocxPlaceholders_(xml, replacements) {
  let result = xml;
  Object.keys(replacements).forEach(function (placeholder) {
    let safety = 0;
    while (docxPlainText_(result).indexOf(placeholder) >= 0 && safety < 100) {
      result = replaceOneDocxPlaceholder_(result, placeholder, replacements[placeholder]);
      safety += 1;
    }
  });
  return result;
}

function replaceOneDocxPlaceholder_(xml, placeholder, replacement) {
  const nodes = [];
  const regex = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = regex.exec(xml))) {
    nodes.push({ start: match.index, end: regex.lastIndex, attrs: match[1] || '', text: xmlDecode_(match[2]) });
  }
  const plain = nodes.map(function (node) { return node.text; }).join('');
  const startOffset = plain.indexOf(placeholder);
  if (startOffset < 0) return xml;
  const endOffset = startOffset + placeholder.length;
  let cursor = 0;
  let startNode = -1;
  let endNode = -1;
  let offsetInStart = 0;
  let offsetInEnd = 0;
  nodes.forEach(function (node, index) {
    const nodeStart = cursor;
    const nodeEnd = cursor + node.text.length;
    if (startNode < 0 && startOffset >= nodeStart && startOffset < nodeEnd) {
      startNode = index;
      offsetInStart = startOffset - nodeStart;
    }
    if (endNode < 0 && endOffset > nodeStart && endOffset <= nodeEnd) {
      endNode = index;
      offsetInEnd = endOffset - nodeStart;
    }
    cursor = nodeEnd;
  });
  if (startNode < 0 || endNode < 0) return xml;
  if (startNode === endNode) {
    nodes[startNode].text = nodes[startNode].text.slice(0, offsetInStart) + replacement + nodes[startNode].text.slice(offsetInEnd);
  } else {
    nodes[startNode].text = nodes[startNode].text.slice(0, offsetInStart) + replacement;
    for (let index = startNode + 1; index < endNode; index += 1) nodes[index].text = '';
    nodes[endNode].text = nodes[endNode].text.slice(offsetInEnd);
  }
  let output = '';
  let last = 0;
  nodes.forEach(function (node) {
    output += xml.slice(last, node.start) + '<w:t' + node.attrs + '>' + xmlEscapePreserve_(node.text) + '</w:t>';
    last = node.end;
  });
  return output + xml.slice(last);
}

function docxPlainText_(xml) {
  const values = [];
  String(xml || '').replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, function (_, text) { values.push(xmlDecode_(text)); return _; });
  return values.join('');
}

function xmlDecode_(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function xmlEscapePreserve_(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function docxPageBreak_() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function nextDocxRelationshipNumber_(xml) {
  const ids = Array.from(String(xml || '').matchAll(/Id=["']rId(\d+)["']/g)).map(function (match) { return Number(match[1]); });
  return (ids.length ? Math.max.apply(null, ids) : 0) + 1;
}

function nextDocxDrawingNumber_(xml) {
  const ids = Array.from(String(xml || '').matchAll(/<wp:docPr\b[^>]*\bid=["'](\d+)["']/g)).map(function (match) { return Number(match[1]); });
  return (ids.length ? Math.max.apply(null, ids) : 0) + 1;
}

function getReceiptExportImageBlob_(file) {
  const source = file.getBlob();
  if (source.getContentType() === 'image/jpeg' && source.getBytes().length <= APP_CONFIG.EXPORT_IMAGE_TARGET_BYTES) return source;
  try {
    const thumbnail = file.getThumbnail();
    if (thumbnail && thumbnail.getBytes().length >= 30000) return thumbnail.setContentType('image/jpeg').setName('card.jpg');
  } catch (ignored) {}
  if (source.getContentType() !== 'image/jpeg') throw apiError_('IMAGE_CONVERSION_REQUIRED', 'รูปบัตรบางไฟล์ไม่สามารถแปลงเป็น JPEG สำหรับ DOCX ได้');
  return source;
}

function convertLegacyDocToDocx_(sourceBlob, name, targetFolder) {
  const boundary = 'phiushub_' + Utilities.getUuid().replace(/-/g, '');
  const metadata = JSON.stringify({ name: name + ' (converted)', mimeType: 'application/vnd.google-apps.document', parents: [targetFolder.getId()] });
  const headerBytes = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata +
    '\r\n--' + boundary + '\r\nContent-Type: application/msword\r\n\r\n').getBytes();
  const footerBytes = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  const payload = headerBytes.concat(sourceBlob.getBytes(), footerBytes);
  const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: payload, muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw apiError_('DOC_CONVERSION_FAILED', 'แปลงไฟล์ DOC ไม่สำเร็จ: ' + cleanString_(response.getContentText(), 300));
  const googleDocId = JSON.parse(response.getContentText()).id;
  try {
    const exportResponse = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(googleDocId) + '/export?mimeType=' + encodeURIComponent(DOCX_MIME), {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
    });
    if (exportResponse.getResponseCode() !== 200) throw apiError_('DOC_CONVERSION_FAILED', 'Google Drive ส่งออก DOCX ไม่สำเร็จ');
    return targetFolder.createFile(exportResponse.getBlob().setName(name + '.docx').setContentType(DOCX_MIME));
  } finally {
    try { DriveApp.getFileById(googleDocId).setTrashed(true); } catch (ignored) {}
  }
}
