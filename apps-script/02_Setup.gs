function setupApp() {
  return withScriptLock_(function () {
    const spreadsheet = getSpreadsheet_();
    Object.keys(SHEET_DEFINITIONS).forEach(function (sheetName) {
      ensureSheet_(spreadsheet, sheetName, SHEET_DEFINITIONS[sheetName]);
    });
    seedMasterData_();
    ensureTaxIdTextStorage_();
    initializeApiSecurity_();
    recordSchemaMigration_(APP_CONFIG.SCHEMA_VERSION, 'V2_BASELINE');
    const root = getRootFolder_();
    CacheService.getScriptCache().put('SETUP_OK_' + APP_CONFIG.SCHEMA_VERSION, '1', 21600);
    return {
      app: APP_CONFIG.APP_NAME,
      version: APP_CONFIG.VERSION,
      spreadsheetName: spreadsheet.getName(),
      rootFolderName: root.getName(),
      rootFolderUrl: root.getUrl(),
      schemaVersion: APP_CONFIG.SCHEMA_VERSION,
      apiVersion: APP_CONFIG.API_VERSION,
      accessMode: 'OPEN',
      loginRequired: false,
      message: 'สร้างโครงสร้างฐานข้อมูลเรียบร้อยแล้ว',
    };
  });
}

function setSecrets(geminiApiKey, lineAccessToken, lineChannelSecret, liffId, frontendUrl) {
  const values = {};
  if (cleanString_(geminiApiKey)) values[PROP_KEYS.GEMINI_API_KEY] = cleanString_(geminiApiKey);
  if (cleanString_(lineAccessToken)) values[PROP_KEYS.LINE_ACCESS_TOKEN] = cleanString_(lineAccessToken);
  if (cleanString_(lineChannelSecret)) values[PROP_KEYS.LINE_CHANNEL_SECRET] = cleanString_(lineChannelSecret);
  if (cleanString_(liffId)) values[PROP_KEYS.LIFF_ID] = cleanString_(liffId);
  if (cleanString_(frontendUrl)) values[PROP_KEYS.FRONTEND_URL] = normalizeHttpsUrl_(frontendUrl);
  PropertiesService.getScriptProperties().setProperties(values, false);
  return { saved: Object.keys(values), message: 'บันทึกค่าใน Script Properties แล้ว' };
}

function getDeploymentSetupInfo() {
  initializeApiSecurity_();
  const webAppUrl = ScriptApp.getService().getUrl() || '';
  const webhookKey = getScriptProperty_(PROP_KEYS.LINE_WEBHOOK_KEY, true);
  return {
    appName: APP_CONFIG.APP_NAME,
    version: APP_CONFIG.VERSION,
    webAppUrl: webAppUrl,
    webhookUrl: webAppUrl ? webAppUrl + '?hook=' + encodeURIComponent(webhookKey) : '',
    frontendUrl: getScriptProperty_(PROP_KEYS.FRONTEND_URL, false),
    liffUrl: getLiffUrl_(),
    spreadsheetUrl: getSpreadsheet_().getUrl(),
  };
}

function getSpreadsheet_() {
  const configuredId = getScriptProperty_(PROP_KEYS.SPREADSHEET_ID, false);
  const spreadsheet = configuredId
    ? SpreadsheetApp.openById(configuredId)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('โปรเจกต์ Apps Script ต้องผูก (container-bound) กับ Google Sheet แล้วจึงรัน setupApp()');
  }
  return spreadsheet;
}

function setSpreadsheetId(spreadsheetId) {
  const id = cleanString_(spreadsheetId, 200);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new Error('Spreadsheet ID ไม่ถูกต้อง');
  const spreadsheet = SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.SPREADSHEET_ID, spreadsheet.getId());
  return { spreadsheetId: spreadsheet.getId(), spreadsheetName: spreadsheet.getName() };
}

function normalizeHttpsUrl_(value) {
  const url = cleanString_(value, 2000).replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) throw new Error('URL ต้องขึ้นต้นด้วย https://');
  return url;
}

function recordSchemaMigration_(version, name) {
  const applied = getRows_(SHEETS.MIGRATIONS).some(function (row) {
    return Number(row.version) === Number(version);
  });
  if (applied) return;
  appendObject_(SHEETS.MIGRATIONS, {
    version: Number(version),
    name: cleanString_(name, 100),
    applied_at: nowIso_(),
  });
}

function ensureSheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  const existingHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    : [];
  if (!existingHeaders.some(String)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (existingHeaders.join('|') !== headers.join('|')) {
    const isSafeAppendMigration = headers.slice(0, existingHeaders.length).join('|') === existingHeaders.join('|');
    if (!isSafeAppendMigration) {
      throw new Error('โครงสร้างชีต ' + sheetName + ' ไม่ตรงกับระบบ กรุณาสำรองข้อมูลก่อนแก้หัวคอลัมน์');
    }
    const missingHeaders = headers.slice(existingHeaders.length);
    if (missingHeaders.length) {
      sheet.getRange(1, existingHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#172554')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setWrap(true);
  sheet.autoResizeColumns(1, headers.length);

  headers.forEach(function (header, index) {
    const column = index + 1;
    if (['tax_id', 'vendor_tax_id', 'buyer_tax_id'].indexOf(header) >= 0 || /_date$/.test(header) || ['created_at', 'updated_at', 'confirmed_at', 'expires_at', 'last_used_at'].indexOf(header) >= 0) {
      sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    } else if (['subtotal', 'discount', 'vat_rate', 'vat_amount', 'withholding_tax', 'grand_total', 'quantity', 'unit_price', 'amount'].indexOf(header) >= 0) {
      sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('#,##0.00');
    }
  });
}

function ensureTaxIdTextStorage_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(PROP_KEYS.TAX_ID_TEXT_MIGRATION) === 'true') return;
  const targets = [
    { sheet: SHEETS.COMPANIES, headers: ['tax_id'] },
    { sheet: SHEETS.VENDORS, headers: ['tax_id'] },
    { sheet: SHEETS.BILLS, headers: ['vendor_tax_id', 'buyer_tax_id'] },
  ];
  targets.forEach(function (target) {
    const sheet = getSheet_(target.sheet);
    const headers = SHEET_DEFINITIONS[target.sheet];
    target.headers.forEach(function (header) {
      const column = headers.indexOf(header) + 1;
      if (!column) return;
      const rows = Math.max(sheet.getMaxRows() - 1, 1);
      sheet.getRange(2, column, rows, 1).setNumberFormat('@');
      const dataRows = Math.max(sheet.getLastRow() - 1, 0);
      if (!dataRows) return;
      const range = sheet.getRange(2, column, dataRows, 1);
      const normalized = range.getDisplayValues().map(function (row) {
        return [normalizeTaxId_(row[0])];
      });
      range.setNumberFormat('@').setValues(normalized);
    });
  });
  properties.setProperty(PROP_KEYS.TAX_ID_TEXT_MIGRATION, 'true');
}

function seedMasterData_() {
  if (!getRows_(SHEETS.PROJECTS).length) {
    appendObject_(SHEETS.PROJECTS, {
      project_id: uuid_(), project_code: 'GENERAL', project_name: 'โครงการทั่วไป', description: '',
      active: true, created_at: nowIso_(), updated_at: nowIso_(),
    });
  }

  if (!getRows_(SHEETS.COMPANIES).length) {
    DEFAULT_COMPANIES.forEach(function (company) {
      appendObject_(SHEETS.COMPANIES, Object.assign({}, company, {
        company_id: uuid_(), active: true, created_at: nowIso_(), updated_at: nowIso_(),
      }));
    });
  }

  if (!getRows_(SHEETS.CATEGORIES).length) {
    DEFAULT_CATEGORIES.forEach(function (category) {
      appendObject_(SHEETS.CATEGORIES, Object.assign({}, category, {
        category_id: uuid_(), active: true, created_at: nowIso_(), updated_at: nowIso_(),
      }));
    });
  }
}
