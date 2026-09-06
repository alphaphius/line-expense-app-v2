function getSheet_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('ไม่พบชีต ' + sheetName + ' กรุณารัน setupApp()');
  return sheet;
}

function getRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values.shift().map(String);
  return values.map(function (row, rowIndex) {
    const object = { _row: rowIndex + 2 };
    headers.forEach(function (header, columnIndex) { object[header] = serializeCellValue_(row[columnIndex], header); });
    return object;
  }).filter(function (object) { return cleanString_(object[headers[0]]); });
}

function appendObject_(sheetName, object) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_DEFINITIONS[sheetName];
  if (!headers) throw new Error('ไม่รู้จักตาราง ' + sheetName);
  const rowNumber = sheet.getLastRow() + 1;
  const values = headers.map(function (header) {
    const value = object[header];
    return value == null ? '' : value;
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  if ([SHEETS.PROJECTS, SHEETS.COMPANIES, SHEETS.CATEGORIES, SHEETS.VENDORS].indexOf(sheetName) >= 0) invalidateMasterCache_();
  return object;
}

function appendObjects_(sheetName, objects) {
  const rows = Array.isArray(objects) ? objects : [];
  if (!rows.length) return [];
  const sheet = getSheet_(sheetName);
  const headers = SHEET_DEFINITIONS[sheetName];
  if (!headers) throw new Error('ไม่รู้จักตาราง ' + sheetName);
  const values = rows.map(function (object) {
    return headers.map(function (header) { return object[header] == null ? '' : object[header]; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  if ([SHEETS.PROJECTS, SHEETS.COMPANIES, SHEETS.CATEGORIES, SHEETS.VENDORS].indexOf(sheetName) >= 0) invalidateMasterCache_();
  return rows;
}

function updateObjectById_(sheetName, idField, id, patch) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_DEFINITIONS[sheetName];
  const idColumn = headers.indexOf(idField) + 1;
  if (idColumn < 1) throw new Error('ไม่พบคีย์ ' + idField);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('ไม่พบข้อมูลที่ต้องการแก้ไข');
  const found = sheet.getRange(2, idColumn, lastRow - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) throw new Error('ไม่พบข้อมูลที่ต้องการแก้ไข');
  const rowNumber = found.getRow();
  const currentValues = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const row = { _row: rowNumber };
  headers.forEach(function (header, index) { row[header] = serializeCellValue_(currentValues[index], header); });
  const nextValues = headers.map(function (header, index) {
    return Object.prototype.hasOwnProperty.call(patch, header) ? (patch[header] == null ? '' : patch[header]) : currentValues[index];
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([nextValues]);
  if ([SHEETS.PROJECTS, SHEETS.COMPANIES, SHEETS.CATEGORIES, SHEETS.VENDORS].indexOf(sheetName) >= 0) invalidateMasterCache_();
  return Object.assign({}, row, patch, { _row: undefined });
}

function findById_(sheetName, idField, id) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_DEFINITIONS[sheetName];
  const idColumn = headers.indexOf(idField) + 1;
  if (idColumn < 1 || sheet.getLastRow() < 2) return null;
  const found = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) return null;
  const values = sheet.getRange(found.getRow(), 1, 1, headers.length).getValues()[0];
  const result = { _row: found.getRow() };
  headers.forEach(function (header, index) { result[header] = serializeCellValue_(values[index], header); });
  return result;
}

function appendAudit_(entityType, entityId, action, before, after, actor) {
  appendObject_(SHEETS.AUDIT, {
    log_id: uuid_(), entity_type: entityType, entity_id: entityId, action: action,
    actor: cleanString_(actor || 'SYSTEM'), before_json: safeJson_(before), after_json: safeJson_(after), created_at: nowIso_(),
  });
}

function listMasterData() {
  try {
    setupIfNeeded_();
    return ok_({
      projects: cachedMasterRows_(SHEETS.PROJECTS).filter(function (row) { return toBoolean_(row.active); }),
      companies: cachedMasterRows_(SHEETS.COMPANIES).filter(function (row) { return toBoolean_(row.active); }),
      categories: cachedMasterRows_(SHEETS.CATEGORIES).filter(function (row) { return toBoolean_(row.active); }),
      vendors: cachedMasterRows_(SHEETS.VENDORS).sort(function (a, b) { return toNumber_(b.use_count) - toNumber_(a.use_count); }),
    });
  } catch (error) { return fail_(error); }
}

function saveMasterData(type, payload) {
  try {
    const map = masterTypeMap_(type);
    const clean = sanitizeMasterPayload_(type, payload || {});
    requireFields_(clean, [map.nameField]);
    if (type === 'company' && !isValidTaxId_(clean.tax_id, false)) throw new Error('เลขผู้เสียภาษีต้องมี 13 หลัก');
    return ok_(withScriptLock_(function () {
      const timestamp = nowIso_();
      if (clean[map.idField]) {
        const before = findById_(map.sheet, map.idField, clean[map.idField]);
        clean.updated_at = timestamp;
        const updated = updateObjectById_(map.sheet, map.idField, clean[map.idField], clean);
        appendAudit_(type, clean[map.idField], 'UPDATE', before, updated, 'WEB');
        return updated;
      }
      clean[map.idField] = uuid_();
      clean.active = true;
      clean.created_at = timestamp;
      clean.updated_at = timestamp;
      appendObject_(map.sheet, clean);
      appendAudit_(type, clean[map.idField], 'CREATE', null, clean, 'WEB');
      return clean;
    }));
  } catch (error) { return fail_(error); }
}

function deleteMasterData(type, id) {
  try {
    const map = masterTypeMap_(type);
    return ok_(withScriptLock_(function () {
      const before = findById_(map.sheet, map.idField, id);
      if (!before) throw new Error('ไม่พบข้อมูล');
      const updated = updateObjectById_(map.sheet, map.idField, id, { active: false, updated_at: nowIso_() });
      appendAudit_(type, id, 'DEACTIVATE', before, updated, 'WEB');
      return { id: id };
    }));
  } catch (error) { return fail_(error); }
}

function masterTypeMap_(type) {
  const maps = {
    project: { sheet: SHEETS.PROJECTS, idField: 'project_id', nameField: 'project_name' },
    company: { sheet: SHEETS.COMPANIES, idField: 'company_id', nameField: 'company_name' },
    category: { sheet: SHEETS.CATEGORIES, idField: 'category_id', nameField: 'category_name' },
  };
  if (!maps[type]) throw new Error('ประเภทข้อมูลไม่ถูกต้อง');
  return maps[type];
}

function sanitizeMasterPayload_(type, payload) {
  if (type === 'project') return {
    project_id: cleanString_(payload.project_id), project_code: cleanString_(payload.project_code, 30),
    project_name: cleanString_(payload.project_name, 150), description: cleanString_(payload.description, 500),
  };
  if (type === 'company') return {
    company_id: cleanString_(payload.company_id), company_name: cleanString_(payload.company_name, 200),
    branch_name: cleanString_(payload.branch_name, 100), tax_id: normalizeTaxId_(payload.tax_id), address: cleanString_(payload.address, 500),
  };
  return {
    category_id: cleanString_(payload.category_id), category_name: cleanString_(payload.category_name, 100), aliases: cleanString_(payload.aliases, 500),
  };
}

function publicRows_(sheetName) {
  return getRows_(sheetName).map(function (row) {
    const result = {};
    Object.keys(row).forEach(function (key) { if (key !== '_row') result[key] = row[key]; });
    return result;
  });
}

function cachedMasterRows_(sheetName) {
  const cache = CacheService.getScriptCache();
  const key = 'MASTER_ROWS_' + sheetName + '_' + APP_CONFIG.SCHEMA_VERSION;
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const rows = publicRows_(sheetName);
  const json = JSON.stringify(rows);
  if (json.length < 90000) cache.put(key, json, 300);
  return rows;
}

function invalidateMasterCache_() {
  const cache = CacheService.getScriptCache();
  [SHEETS.PROJECTS, SHEETS.COMPANIES, SHEETS.CATEGORIES, SHEETS.VENDORS].forEach(function (sheetName) {
    cache.remove('MASTER_ROWS_' + sheetName + '_' + APP_CONFIG.SCHEMA_VERSION);
  });
}

function setupIfNeeded_() {
  const cache = CacheService.getScriptCache();
  const setupKey = 'SETUP_OK_' + APP_CONFIG.SCHEMA_VERSION;
  if (cache.get(setupKey)) return;
  const spreadsheet = getSpreadsheet_();
  const needsSetup = Object.keys(SHEET_DEFINITIONS).some(function (sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return true;
    const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].filter(String);
    const expected = SHEET_DEFINITIONS[sheetName];
    return current.join('|') !== expected.join('|');
  });
  if (needsSetup) setupApp();
  else {
    ensureTaxIdTextStorage_();
    initializeApiSecurity_();
    cache.put(setupKey, '1', 21600);
  }
}
