import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

// Frozen V1 compatibility contract. Keep this repository self-contained so the
// same checks run locally, in GitHub Actions, and after a fresh clone.
const expectedV1Ids = [
  'activity-toast', 'activity-toast-detail', 'activity-toast-icon', 'activity-toast-title',
  'all-bills-table', 'bill-category-filter', 'bill-company-filter', 'bill-date-from',
  'bill-date-to', 'bill-files', 'bill-list-count', 'bill-next', 'bill-page-info',
  'bill-prev', 'bill-project-filter', 'bill-search', 'bill-sort', 'bill-status',
  'bill-table', 'category-list', 'company-list', 'dashboard-bill-list-helper',
  'dashboard-bill-list-title', 'dashboard-filter-feedback', 'dashboard-month',
  'dashboard-next-month', 'dashboard-owner-clear', 'dashboard-owner-filter',
  'dashboard-owner-options', 'dashboard-owner-select-all', 'dashboard-prev-month',
  'drop-zone', 'expected-pages', 'export-month', 'export-monthly-btn', 'file-list',
  'export-excel-btn',
  'loading-screen', 'metric-current-month', 'metric-current-month-label',
  'metric-current-year', 'metric-current-year-label', 'metric-previous-month',
  'metric-review', 'monthly-chart-canvas-wrap', 'monthly-chart-empty',
  'monthly-chart-scroll', 'monthly-history-chart', 'open-database-btn',
  'open-review-queue', 'person-breakdown-card', 'person-breakdown-list',
  'person-breakdown-period', 'previous-month-label', 'previous-month-projects',
  'project-list', 'quick-company-1', 'quick-company-2', 'quick-page-count-1',
  'quick-page-count-2', 'quick-project-1', 'quick-project-2',
  'quick-settings-status-1', 'quick-settings-status-2', 'refresh-btn',
  'review-inbox', 'review-inbox-count', 'search-bills-btn', 'system-status',
  'upload-company', 'upload-form', 'upload-project', 'upload-quick-options',
  'upload-owner',
  'upload-quick-preset', 'uploader-summary-bars', 'uploader-summary-card',
  'uploader-summary-period', 'vendor-suggestions', 'vendor-tags', 'view-bills',
  'view-dashboard', 'view-masters', 'view-system', 'view-title', 'view-upload',
];

const expectedV1Calls = [
  'backfillLineUsernames', 'clearQuickSettings', 'confirmBill', 'deleteBill',
  'deleteMasterData', 'exportMonthlyBillExcel', 'exportMonthlyBillWord',
  'getBillDetail', 'getBillDetail', 'getBillDetail', 'getBillDocumentPreview', 'getBillOwners', 'getBootstrapData',
  'getDashboard', 'getExportFileChunk', 'getSystemStatus', 'listBills', 'listBills',
  'listPendingReviewBills', 'restoreBill', 'saveMasterData', 'saveQuickSettings',
  'submitBillPages', 'updateBill', 'verifyDatabaseAccess',
];

test('GitHub Pages HTML preserves every V1 screen element id', async () => {
  const v2 = await read('frontend/index.html');
  const ids = source => new Set(Array.from(source.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const actualIds = ids(v2);
  expectedV1Ids.forEach(id => assert.ok(actualIds.has(id), `missing V1 element #${id}`));
  ['view-receipts','view-payroll','view-tasks','receipt-template-form','receipt-card-files','receipt-quick-edit-list','receipt-registry-list','receipt-export-docx-btn','receipt-export-excel-btn'].forEach(id => assert.ok(actualIds.has(id), `missing WorkHub element #${id}`));
  assert.doesNotMatch(v2, /<\?(?:=|!=)/);
  assert.doesNotMatch(v2, /cdn\.tailwindcss\.com/);
  assert.ok(v2.indexOf('ส่วนงานหลัก') < v2.indexOf('เมนูค่าใช้จ่าย'), 'primary WorkHub modules must appear above expense navigation');
  assert.ok(v2.indexOf('image GFE') < 0, 'accessibility snapshots must not be embedded in source');
});

test('frontend calls the same business functions as V1 through the API adapter', async () => {
  const v2 = await read('frontend/app.js');
  const calls = source => Array.from(source.matchAll(/(?:gas|callWithRequestId)\('([A-Za-z0-9_]+)'/g), match => match[1]).sort();
  assert.deepEqual(calls(v2), expectedV1Calls);
  assert.match(v2, /window\.V2Api\.call/);
  assert.doesNotMatch(v2, /google\.script\.run/);
});

test('browser scripts parse and image compression is bounded', async () => {
  for (const file of ['frontend/config.js', 'frontend/api.js', 'frontend/image-optimizer.js', 'frontend/offline-ocr.js', 'frontend/protected-access.js', 'frontend/receipts.js', 'frontend/app.js', 'frontend/pwa.js', 'frontend/service-worker.js']) {
    const source = await read(file);
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  }
  const optimizer = await read('frontend/image-optimizer.js');
  assert.match(optimizer, /maxLongEdge:\s*1800/);
  assert.match(optimizer, /targetBytes:\s*1200\s*\*\s*1024/);
  assert.match(optimizer, /Math\.min\(2, list\.length\)/);
});

test('payment receipt module uses bounded local OCR, quick edit, duplicate review, and split exports', async () => {
  const frontend = await read('frontend/receipts.js');
  assert.match(frontend, /OfflineThaiIdOcr\.recognize/);
  assert.match(frontend, /saveReceiptCardDraft/);
  assert.match(frontend, /saveReceiptRegistrations/);
  assert.match(frontend, /previewReceiptExport/);
  assert.match(frontend, /exportReceiptDocuments/);
  assert.match(frontend, /exportReceiptRosterExcel/);

  const backend = await read('apps-script/18_ReceiptDocuments.gs');
  assert.match(backend, /RECEIPT_MODULE_DISABLED/);
  assert.match(backend, /isValidThaiNationalId_/);
  assert.match(backend, /findReceiptDuplicate_/);
  assert.match(backend, /replaceDocxPlaceholders_/);
  assert.match(backend, /Utilities\.unzip/);
  assert.doesNotMatch(backend, /analyzeThaiIdCard_|generativelanguage\.googleapis\.com|logAiUsage_/);
});

test('offline Thai ID parser validates checksum and extracts editable fields without AI', async () => {
  const source = await read('frontend/offline-ocr.js');
  const context = vm.createContext({
    window: {}, document: { baseURI:'https://example.com/' }, navigator: { hardwareConcurrency:2 },
    URL, Set, Promise, Object, String, Array, Math, Number, RegExp,
  });
  new vm.Script(source, { filename:'offline-ocr.js' }).runInContext(context);
  const parsed = context.window.OfflineThaiIdOcr.parseThaiIdText('เลขประจำตัวประชาชน 1 1017 00207 03 0\nชื่อและนามสกุล นาย สมชาย ใจดี\nที่อยู่ 99 ถนนสุขุมวิท\nแขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร\nวันเกิด 1 มกราคม 2530', 88);
  assert.equal(parsed.full_name, 'สมชาย ใจดี');
  assert.equal(parsed.national_id, '1101700207030');
  assert.match(parsed.address, /สุขุมวิท/);
  assert.equal(context.window.OfflineThaiIdOcr.validateNationalId(parsed.national_id), true);
});

test('DOCX placeholder replacement preserves split Word runs and surrounding spaces', async () => {
  const source = await read('apps-script/18_ReceiptDocuments.gs');
  const context = vm.createContext({ Object, String, Array, Math, Number, JSON, RegExp });
  new vm.Script(source, { filename:'18_ReceiptDocuments.gs' }).runInContext(context);
  const xml = '<w:p><w:r><w:t xml:space="preserve">ก่อน </w:t></w:r><w:r><w:t>{ชื่อ</w:t></w:r><w:r><w:t>สกุล}</w:t></w:r><w:r><w:t xml:space="preserve"> หลัง</w:t></w:r></w:p>';
  const result = context.replaceDocxPlaceholders_(xml, { '{ชื่อสกุล}':'สมชาย ใจดี' });
  assert.equal(context.docxPlainText_(result), 'ก่อน สมชาย ใจดี หลัง');
});

test('open access starts and renews a technical session without a PIN screen', async () => {
  const api = await read('frontend/api.js');
  assert.match(api, /request\('openSession', \[getDeviceId\(\)\]\)/);
  assert.doesNotMatch(api, /promptPin|forcePinChange|verifyPin|changePin|api-pin-input/);

  const backend = (await Promise.all((await readdir(path.join(root, 'apps-script')))
    .filter(file => file.endsWith('.gs')).sort().map(file => read(`apps-script/${file}`)))).join('\n');
  assert.match(backend, /accessMode:\s*'OPEN'/);
  assert.match(backend, /loginRequired:\s*false/);
  assert.match(backend, /function openApiSession/);
  assert.doesNotMatch(backend, /function verifyApiPin|function changeApiPin|API_PIN_HASH/);
});

test('protected work areas require a server-issued session while expenses stay open', async () => {
  const api = await read('frontend/api.js');
  const app = await read('frontend/app.js');
  const backend = await read('apps-script/19_ProtectedAccess.gs');
  assert.match(api, /protectedToken/);
  assert.match(api, /openProtectedSession/);
  assert.match(api, /localStorage\.setItem\(keys\.protectedSession/);
  assert.match(api, /result && result\.error && result\.error\.message/);
  assert.match(app, /protectedViews = \['receipts','payroll','tasks'\]/);
  assert.match(backend, /function requireProtectedSession_/);
  assert.match(backend, /PROTECTED_MAX_ATTEMPTS/);
  assert.match(backend, /'verifyDatabaseAccess'/);
  assert.doesNotMatch(api + app + backend, /gfe123456_/);
});

test('Apps Script source parses and exposes only allowlisted frontend actions', async () => {
  const files = (await readdir(path.join(root, 'apps-script'))).filter(file => file.endsWith('.gs')).sort();
  const source = (await Promise.all(files.map(file => read(`apps-script/${file}`)))).join('\n');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'apps-script-v2.gs' }));
  assert.match(source, /function apiActionHandler_/);
  assert.match(source, /ACTION_NOT_ALLOWED/);
  assert.match(source, /function requireApiSession_/);
  assert.match(source, /function getLineContextId_/);
  assert.match(source, /source_context_id/);
  assert.doesNotMatch(source, /APP_CONFIG\.WEB_APP_URL/);
  assert.doesNotMatch(source, /DATABASE_ACCESS_PASSWORD_SHA256/);
});

test('repository contains no live V1 identifiers or embedded credentials', async () => {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'tests'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(root);
  const source = (await Promise.all(files.map(file => readFile(file, 'utf8').catch(() => '')))).join('\n');
  assert.doesNotMatch(source, /13wQin-j-zUdPYJTTSOtwJN01okmoEhFFWwnTDDgKYc7B9C-fLse3CKAQ/);
  assert.doesNotMatch(source, /10iEWHITGi7vKg09TXEGzp7GgBRMLzzE6ANwgEehlDKU/);
  assert.doesNotMatch(source, /AKfycbymQD7snXoRZQbORrsljbKZvfeDi3kw0A9v8NEXYjYAyMhWAHjCXQyAcWM3GCxHx3Ij/);
  assert.doesNotMatch(source, /2009457348-SwkPdMG3/);
  assert.doesNotMatch(source, /gfe123456_/);
});

test('service worker caches only same-origin static GET assets', async () => {
  const worker = await read('frontend/service-worker.js');
  assert.match(worker, /event\.request\.method !== 'GET'/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(worker, /script\.google\.com/);
  assert.match(worker, /\.\/receipts\.js/);
  assert.match(worker, /\.\/offline-ocr\.js/);
  assert.match(worker, /vendor\/tesseract/);
  assert.match(worker, /event\.request\.mode === 'navigate'/);
  assert.match(worker, /Response\.error\(\)/);
});

test('local preview is isolated from the production API', async () => {
  const server = await read('scripts/dev-server.mjs');
  assert.match(server, /apiEndpoint:location\.origin\+'\/__mock_api__'/);
  assert.match(server, /pathname === '\/__mock_api__'/);
  assert.doesNotMatch(server, /script\.google\.com\/macros\/s\//);
});
