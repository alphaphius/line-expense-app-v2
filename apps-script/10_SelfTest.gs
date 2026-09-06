function runSelfTest() {
  const checks = [];
  function check(name, condition, detail) {
    checks.push({ name: name, passed: !!condition, detail: detail || '' });
    if (!condition) throw new Error('Self-test failed: ' + name + (detail ? ' — ' + detail : ''));
  }

  const setup = setupApp();
  check('Spreadsheet พร้อมใช้งาน', !!setup.spreadsheetName, setup.spreadsheetName);
  check('Drive root folder ถูกต้อง', setup.rootFolderName === APP_CONFIG.ROOT_FOLDER_NAME, setup.rootFolderName);
  Object.keys(SHEET_DEFINITIONS).forEach(function (sheetName) {
    const sheet = getSheet_(sheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    check('โครงสร้าง ' + sheetName, headers.join('|') === SHEET_DEFINITIONS[sheetName].join('|'));
  });

  check('ตัดช่องว่างและจำกัดความยาว', cleanString_('  ABCD  ', 3) === 'ABC');
  check('ปรับชื่อไทยเพื่อจับคู่', normalizeThaiText_('บริษัท ทดสอบ จำกัด') === 'ทดสอบ');
  check('Tax ID เก็บเลขศูนย์นำหน้า', normalizeTaxId_('010-5536-084347') === '0105536084347');
  check('ซ่อม Tax ID ที่ Sheet เคยตัดศูนย์นำหน้า', normalizeTaxId_('105536084347') === '0105536084347');
  check('ตรวจ Tax ID 13 หลัก', isValidTaxId_('0105536084347', false) && !isValidTaxId_('12345', false));
  check('แปล boolean', toBoolean_('TRUE') && !toBoolean_('0'));
  check('แปลตัวเลขที่มี comma', toNumber_('1,234.50') === 1234.5);
  check('แปล พ.ศ. เป็น ค.ศ.', toIsoDate_('2569-07-17') === '2026-07-17');
  check('ปฏิเสธวันที่ไม่มีจริง', toIsoDate_('2026-02-31') === '');
  check('แสดงวันที่ภาษาไทย', formatThaiDateLong_('2026-07-17') === 'วันศุกร์ ที่ 17 กรกฎาคม 2569');
  const normalDateRange = billDateNormalRange_('2026-07-26');
  check('ช่วงวันที่บิลปกติย้อนหลังสองเดือน', normalDateRange.minimum === '2026-05-01' && normalDateRange.maximum === '2026-07-26');
  check('วันที่ในช่วงปกติไม่เตือน', billDateReviewWarning_('2026-05-01', '2026-07-26') === '');
  check('เตือนวันที่ย้อนหลังเกินสองเดือน', billDateReviewWarning_('2026-04-30', '2026-07-26').indexOf('ย้อนหลังเกิน 2 เดือน') >= 0);
  check('เตือนวันที่อนาคต', billDateReviewWarning_('2026-07-27', '2026-07-26').indexOf('วันอนาคต') >= 0);
  check('จับคู่ที่อยู่บริษัท', isAddressMatch_('151 ถ.นวลจันทร์ เขตบึงกุ่ม กรุงเทพฯ 10230', DEFAULT_COMPANIES[0].address));
  check('ทำชื่อ Folder ให้ปลอดภัย', sanitizeFolderName_('A/B:C') === 'A-B-C');
  check('สร้าง JSON', safeJson_({ a: 1 }) === '{"a":1}');
  check('ตรวจ field ที่ขาด', selfTestExpectThrow_(function () { requireFields_({}, ['name']); }));
  check('ห่อผลลัพธ์ success', ok_(123).ok && ok_(123).data === 123);

  const companyPayload = sanitizeMasterPayload_('company', { company_name: ' X ', tax_id: '0012345678901' });
  check('รักษา Tax ID เป็นข้อความ', companyPayload.tax_id === '0012345678901');
  check('แผนที่ Master Data', masterTypeMap_('project').sheet === SHEETS.PROJECTS && selfTestExpectThrow_(function () { masterTypeMap_('invalid'); }));
  check('มีบริษัทเริ่มต้น 2 บริษัท', getRows_(SHEETS.COMPANIES).length >= 2);
  check('มีหมวดหมู่เริ่มต้น', getRows_(SHEETS.CATEGORIES).length >= DEFAULT_CATEGORIES.length);
  check('ซ่อน _row จาก API', publicRows_(SHEETS.COMPANIES).every(function (row) { return !Object.prototype.hasOwnProperty.call(row, '_row'); }));

  const parsedImage = parseDataUrl_('data:image/png;base64,iVBORw0KGgo=');
  check('แยก Data URL', parsedImage.mimeType === 'image/png' && parsedImage.bytes.length > 0);
  check('ปฏิเสธไฟล์ไม่รองรับ', selfTestExpectThrow_(function () { parseDataUrl_('data:text/plain;base64,QQ=='); }));
  check('สร้างเส้นทางเก็บรูป', folderPathFor_('โครงการ A', '2026-07-17') === 'Line-Expense-App-V2/โครงการ A/2026-07/images');

  const prompt = buildGeminiPrompt_({ companies: DEFAULT_COMPANIES, categories: DEFAULT_CATEGORIES, receivedDate: '2026-07-26' }, 2);
  check('Gemini prompt รองรับหลายหน้า', prompt.indexOf('2 หน้า') >= 0 && prompt.indexOf('รูเจาะ') >= 0);
  check('Gemini ห้ามเดาวันที่และห้ามใช้วันรับแทน', prompt.indexOf('ให้คืน document_date เป็นค่าว่าง') >= 0 && prompt.indexOf('ห้ามนำมาใส่ document_date') >= 0);
  const schema = billResponseSchema_();
  check('Gemini schema ครบ', schema.required.indexOf('grand_total') >= 0 && schema.properties.doc_type.enum.indexOf('TOLL') >= 0);
  const aiResult = validateAiResult_({
    company_id: 'invalid', category_id: 'invalid', document_date: '2569-07-17', due_date: '', vendor_name: '',
    vendor_tax_id: '001-234', buyer_tax_id: '010-5536-084347', subtotal: '100', discount: 0, vat_rate: 7,
    vat_amount: 7, withholding_tax: 0, grand_total: '107', quality_score: 50, needs_review: false,
    review_reasons: [], items: [],
  }, { companies: [], categories: [] });
  check('ตรวจผล AI และเตือนรูปไม่ชัด', aiResult.needs_review && aiResult.document_date === '2026-07-17' && aiResult.review_reasons.length > 0);
  const missingDateAiResult = validateAiResult_({
    company_id: '', category_id: '', document_date: '', due_date: '', vendor_name: 'ร้านทดสอบ',
    vendor_tax_id: '', buyer_tax_id: '', subtotal: 100, discount: 0, vat_rate: 0, vat_amount: 0,
    withholding_tax: 0, grand_total: 100, quality_score: 90, needs_review: false, review_reasons: [], items: [],
  }, { companies: [], categories: [], receivedDate: '2026-07-26' });
  check('วันที่หายใช้วันรับบิลเป็นค่าเริ่มต้นโดยไม่เดา', missingDateAiResult.document_date === '2026-07-26' && missingDateAiResult.document_date_missing === true &&
    missingDateAiResult.needs_review && missingDateAiResult.review_reasons.some(isMissingBillDateFallbackReason_));
  const missingDateReason = missingBillDateFallbackReason_('2026-07-26');
  check('เหตุผลวันที่ fallback คงอยู่จนกว่าจะแก้วันที่', refreshBillDateReviewReasons_([missingDateReason], '', { preserveMissingFallback:true }).length === 1 &&
    refreshBillDateReviewReasons_([missingDateReason], '').length === 0);

  const grouped = aggregate_([{ grand_total: 10, group: 'A' }, { grand_total: 25, group: 'A' }], function (row) { return row.group; });
  check('รวมยอด Dashboard', grouped.length === 1 && grouped[0].total === 35 && grouped[0].count === 2);
  const dashboardSummary = buildDashboardSummary_([
    { document_date: '2026-01-05', grand_total: 100, project_id: 'P1', status: 'CONFIRMED' },
    { document_date: '2025-12-12', grand_total: 200, project_id: 'P1', status: 'CONFIRMED' },
    { document_date: '2025-12-20', grand_total: 300, project_id: 'P2', status: 'NEEDS_REVIEW' },
  ], [
    { project_id: 'P1', project_name: 'โครงการหนึ่ง' },
    { project_id: 'P2', project_name: 'โครงการสอง' },
    { project_id: 'P3', project_name: 'โครงการไม่มีบิล' },
  ], '2026-01');
  check('Dashboard สรุปเดือนและปีปัจจุบัน', dashboardSummary.currentMonth.total === 100 && dashboardSummary.currentYear.total === 100);
  check('Dashboard ย้อนเดือนข้ามปี', dashboardSummary.previousMonth.period === '2025-12' && dashboardSummary.previousMonth.total === 500);
  check('Dashboard แสดงเฉพาะโครงการที่มีข้อมูล', dashboardSummary.previousMonth.projects.length === 2 && dashboardSummary.previousMonth.projects.every(function (row) { return row.project_id !== 'P3'; }));
  check('Dashboard นับรายการรอตรวจสอบ', dashboardSummary.reviewCount === 1);
  const uploaderSummary = aggregateUploaderSummary_([
    { source_user_id: 'สมชาย', source: 'LINE', grand_total: 100 },
    { source_user_id: 'สมชาย', source: 'LINE', grand_total: 250 },
    { source_user_id: 'สุดา', source: 'LINE', grand_total: 500 },
  ]);
  check('Dashboard รวมจำนวนบิลและยอดตามผู้ส่ง', uploaderSummary[0].label === 'สุดา' && uploaderSummary[1].label === 'สมชาย' && uploaderSummary[1].count === 2 && uploaderSummary[1].total === 350);
  check('Dashboard เลือกเดือนย้อนหลังและกันเดือนอนาคต', normalizeDashboardPeriod_('2025-12', '2026-07') === '2025-12' && normalizeDashboardPeriod_('2026-08', '2026-07') === '2026-07');
  check('Dashboard กรองเจ้าของบิลซ้ำและชื่อที่ไม่มีในเดือน', sanitizeDashboardOwners_(['สมชาย','สมชาย','ไม่มีชื่อ'], ['สมชาย','สุดา']).join(',') === 'สมชาย');
  const ownerBreakdowns = buildOwnerCategoryBreakdowns_([
    { source_user_id: 'สมชาย', category_id: 'C1', grand_total: 100 },
    { source_user_id: 'สมชาย', category_id: 'C2', grand_total: 250 },
    { source_user_id: 'สุดา', category_id: 'C1', grand_total: 500 },
  ], { C1:'เดินทาง', C2:'วัสดุ' });
  check('Dashboard สรุปหมวดและยอดรวมรายบุคคล', ownerBreakdowns.length === 2 && ownerBreakdowns[0].label === 'สุดา' && ownerBreakdowns[1].total === 350 &&
    ownerBreakdowns[1].categories.length === 2);
  const dashboardOrder = [
    { document_date: '2026-07-20', created_at: '2026-07-20T08:00:00+07:00' },
    { document_date: '2026-07-25', created_at: '2026-07-25T08:00:00+07:00' },
  ].sort(compareBillsByDocumentDateDesc_);
  check('Dashboard เรียงวันที่ในบิลใหม่สุด', dashboardOrder[0].document_date === '2026-07-25');
  check('สร้าง index', indexBy_([{ id: 'a', name: 'A' }], 'id', 'name').a === 'A');
  check('สถานะลบบิล', deletedBillPatch_({ notes: '' }, 'WEB', 'now').status === 'REJECTED');
  check('กู้คืนบิลเข้าคิวตรวจสอบ', restoredBillPatch_({ review_reasons: '' }, 'now').status === 'NEEDS_REVIEW');
  initializeApiSecurity_();
  check('เก็บรหัสเปิดฐานข้อมูลเป็น salted hash', /^[0-9a-f]{64}$/.test(getScriptProperty_(PROP_KEYS.API_PIN_HASH, true)) &&
    sha256Hex_('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' &&
    !isDatabaseAccessPassword_('wrong-password'));

  const savedFlex = buildBillSavedFlex({ bill_id: 'bill-self-test', document_no: 'T-1', document_date: '2026-07-17', grand_total: 107, vendor_name: 'ร้านทดสอบ' }, 'https://example.com/app/');
  check('Flex ยืนยันบันทึกบิล', savedFlex.type === 'flex' && savedFlex.contents.footer.contents[0].action.uri.indexOf('bill_id=bill-self-test') >= 0);
  check('Flex บันทึกแยกสีจาก Flex ตรวจบิล', savedFlex.contents.header.backgroundColor === '#31473A' && savedFlex.altText.indexOf('✅ บันทึกบิลแล้ว') === 0);
  const lineBill = { bill_id: 'bill-line-test', session_id: 'session-line-test', source: 'LINE' };
  const lineSession = { session_id: 'session-line-test', source: 'LINE', source_user_id: 'U0123456789abcdef0123456789abcdef' };
  check('ยืนยันจากเว็บเตรียมส่ง Flex กลับ LINE', shouldPushSavedFlexAfterConfirm_('WEB', lineBill, true));
  check('ยืนยันตรงจาก LINE ไม่ส่ง Flex ซ้ำ', !shouldPushSavedFlexAfterConfirm_(lineSession.source_user_id, lineBill, true));
  check('หา LINE User ID เดิมจาก Upload Session', resolveOriginalLineUserId_(lineBill, lineSession) === lineSession.source_user_id);
  check('ปฏิเสธผู้รับ LINE ที่ไม่ถูกต้อง', resolveOriginalLineUserId_(lineBill, { session_id: 'session-line-test', source: 'LINE', source_user_id: 'ผู้ใช้งาน' }) === '');
  check('แปลประเภทบิล', docTypeThai_('CASH_BILL') === 'บิลเงินสด');
  check('จัดรูปแบบเงิน', formatMoney_('1,234.5') === '1,234.50');
  check('Flex จำนวนหน้ามี 1 หน้า', pageCountMessage_('session', 1, { configured: false }).contents.body.contents.some(function (row) {
    return (row.contents || []).some(function (button) { return button.action && button.action.label === '1 หน้า (ใบเดียว)'; });
  }));
  const quickSelection = validateQuickSettingsSelection_(
    { page_count: 2, project_id: 'P1', company_id: 'C1' },
    [{ project_id: 'P1', project_name: 'โครงการหลัก', active: true }],
    [{ company_id: 'C1', company_name: 'บริษัทหลัก', active: true }]
  );
  check('ตรวจข้อมูลค่าลัด', quickSelection.page_count === 2 && quickSelection.project_id === 'P1' && quickSelection.company_id === 'C1');
  check('ปฏิเสธจำนวนหน้าค่าลัดผิดช่วง', selfTestExpectThrow_(function () {
    validateQuickSettingsSelection_({ page_count: 0, project_id: 'P1', company_id: 'C1' }, [], []);
  }));
  check('รองรับค่าลัดสองช่อง', normalizeQuickSettingSlot_(1) === 1 && normalizeQuickSettingSlot_(2) === 2);
  check('ค่าลัดเดิมคงเป็นชุดที่ 1', quickSettingKeys_(1).project_id === PROP_KEYS.QUICK_PROJECT_ID);
  check('ค่าลัดชุดที่ 2 แยก Script Properties', quickSettingKeys_(2).project_id === PROP_KEYS.QUICK2_PROJECT_ID);
  const quickFlexJson = safeJson_(pageCountMessage_('session', 1, {
    slots: [
      { slot: 1, label: 'ค่าลัด 1', configured: true, page_count: 1, project_id: 'P1', project_name: 'โครงการหลัก', company_id: 'C1', company_name: 'บริษัทหลัก' },
      { slot: 2, label: 'ค่าลัด 2', configured: true, page_count: 2, project_id: 'P2', project_name: 'โครงการรอง', company_id: 'C2', company_name: 'บริษัทสำรอง' },
    ],
  }));
  check('Flex มีค่าลัดชุดที่ 1', quickFlexJson.indexOf('action=use_quick_settings') >= 0 && quickFlexJson.indexOf('slot=1') >= 0);
  check('Flex มีค่าลัดชุดที่ 2', quickFlexJson.indexOf('slot=2') >= 0 && quickFlexJson.indexOf('ใช้ค่าลัด 2') >= 0);
  check('ยังรองรับข้อมูลค่าลัดรูปแบบเดิม', configuredQuickSettings_({ configured: true, page_count: 1 }).length === 1);
  check('สร้าง Quick Reply', quickReplyMessage_('x', [postbackQuickAction_('A', 'a=1', 'A')]).quickReply.items.length === 1);
  check('แยก LINE postback', parseQueryString_('action=confirm&bill_id=A%201').bill_id === 'A 1');
  check('รองรับ LIFF แบบตั้งค่าภายหลัง', !getLiffId_() || /^https:\/\/liff\.line\.me\//.test(getLiffUrl_()));

  check('แปลวันที่ระบบเดิม', parseLegacyDate_('17/07/2569') === '2026-07-17');
  const month = parseExportMonth_('2026-07');
  check('แปลเดือน Export', month.from === '2026-07-01' && month.to === '2026-07-31');
  check('ปฏิเสธเดือนไม่ถูกต้อง', selfTestExpectThrow_(function () { parseExportMonth_('2026-13'); }));
  check('ชื่อเดือนภาษาไทย', thaiMonthYear_(2026, 7) === 'กรกฎาคม 2569');
  check('ป้องกัน XML', xmlEscape_('A&B<"') === 'A&amp;B&lt;&quot;');
  check('ดึง File ID จากลิงก์ Drive แบบ file/d', extractDriveFileId_('https://drive.google.com/file/d/1OXk_wSkUo7Ra3le9kmFA0l7_W4gIeoRR/view?usp=drivesdk') === '1OXk_wSkUo7Ra3le9kmFA0l7_W4gIeoRR');
  check('ดึง File ID จากลิงก์ Drive แบบ id query', extractDriveFileId_('https://drive.google.com/open?id=1OXk_wSkUo7Ra3le9kmFA0l7_W4gIeoRR') === '1OXk_wSkUo7Ra3le9kmFA0l7_W4gIeoRR');
  check('จำแนกไฟล์รูป Word', docxImageType_('image/jpeg', '').extension === 'jpg' && docxImageType_('', 'a.png').extension === 'png');
  check('จำแนก JPEG จาก MIME แบบเส้นทางเดิม', docxImageType_('image/jpeg', 'bill-image').extension === 'jpg');
  check('กู้ File ID จากลิงก์ Drive สำหรับข้อมูลเก่า', extractDriveFileId_('https://drive.google.com/file/d/1OXk_wSkUo7Ra3le9kmFA0l7_W4gIeoRR/view?usp=drivesdk') === '1OXk_wSkUo7Ra3le9kmFA0l7_W4gIeoRR');
  const pngDimensions = readImageDimensions_([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,0,3], 'png');
  check('อ่านขนาด PNG', pngDimensions.width === 2 && pngDimensions.height === 3);
  const fitted = fitDocxImage_({ width: 1000, height: 2000 }, 4, 4);
  check('ย่อรูปโดยไม่บิดเบี้ยว', fitted.width === 2 && fitted.height === 4);
  const docx = buildMonthlyBillDocx_([{ bill_id: 'b1', vendor_name: 'ร้านทดสอบ', document_date: '2026-07-17', doc_type: 'RECEIPT', grand_total: 107 }], {}, 'SelfTest');
  check('สร้าง Word โดยไม่ใช้ DocumentApp', docx.getBytes().length > 100);
  const driveExportResult = buildDriveExportResult_({
    getId: function () { return 'mock-export-file-id-1234567890'; },
    getSize: function () { return 46 * 1024 * 1024; },
    getUrl: function () { return 'https://drive.google.com/file/mock'; },
  }, 'large.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 12);
  check('Export มากกว่า 45 MB ใช้ token ดาวน์โหลดแบบแบ่งช่วง', driveExportResult.sizeBytes > 45 * 1024 * 1024 &&
    driveExportResult.delivery === 'chunked' && !!driveExportResult.downloadToken && !Object.prototype.hasOwnProperty.call(driveExportResult, 'downloadUrl'));
  check('ปฏิเสธ File ID ที่ส่งตรงแทน download token', selfTestExpectThrow_(function () { exportDownloadCacheKey_('1OXk_wSkUo7Ra3le9kmFA0l7_W4gIeoRR'); }));

  const excelCheck = selfTestMonthlyExcel_();
  check('Excel มีแถวรวมยอดท้ายตาราง', excelCheck.formula === '=SUM(F3:F4)' && Math.abs(excelCheck.total - 350.75) < 0.001, excelCheck.formula + ' = ' + excelCheck.total);
  check('Excel ระบุจำนวนบิล', excelCheck.countLabel === 'จำนวน 2 บิล');

  return { passed: true, checks: checks, total: checks.length, testedAt: nowIso_(), version: APP_CONFIG.VERSION };
}

function runFullSystemTest() {
  const result = runSelfTest();
  const integration = [];
  function record(name, response, detail) {
    const passed = !!response;
    integration.push({ name: name, passed: passed, detail: detail || '' });
    if (!passed) throw new Error('Integration test failed: ' + name + (detail ? ' — ' + detail : ''));
  }
  const masters = listMasterData();
  record('Master Data API', masters.ok && masters.data && masters.data.companies, masters.error);
  const dashboard = getDashboard({});
  record('Dashboard API', dashboard.ok && dashboard.data && dashboard.data.totals, dashboard.error);
  const bills = listBills({ page: 1, page_size: 10 });
  record('Bill list/filter/sort API', bills.ok && bills.data && Array.isArray(bills.data.rows), bills.error);
  const pending = listPendingReviewBills();
  record('Pending review queue API', pending.ok && Array.isArray(pending.data), pending.error);
  const bootstrap = getBootstrapData({});
  record('Web bootstrap API', bootstrap.ok && bootstrap.data && bootstrap.data.masters && bootstrap.data.dashboard && bootstrap.data.quickSettings, bootstrap.error);
  const healthJson = JSON.parse(doGet({ parameter: {} }).getContent());
  record('Web API health', healthJson.ok && healthJson.data.apiVersion === APP_CONFIG.API_VERSION);
  const webhookHtml = doPost({ parameter: { hook: getScriptProperty_(PROP_KEYS.LINE_WEBHOOK_KEY, true) }, postData: { contents: '{"events":[]}' } }).getContent();
  record('Webhook HTTP body', webhookHtml === 'OK', webhookHtml);
  const status = getSystemStatus();
  record('System diagnostics', status.ok && status.data && status.data.lineDiagnostics && status.data.geminiDiagnostics, status.error);
  if (bills.ok && bills.data.rows.length) {
    const detail = getBillDetail(bills.data.rows[0].bill_id);
    record('Bill detail API', detail.ok && detail.data && detail.data.bill_id, detail.error);
    const flex = buildBillConfirmationFlex(bills.data.rows[0].bill_id, getLiffUrl_());
    record('Bill confirmation Flex', flex.type === 'flex' && !!flex.contents);
  } else {
    integration.push({ name: 'Bill detail/Flex', passed: true, detail: 'ไม่มีบิลให้ทดสอบ จึงข้ามแบบปลอดภัย' });
  }
  result.integration = integration;
  result.total += integration.length;
  result.testedAt = nowIso_();
  return result;
}

function selfTestExpectThrow_(callback) {
  try { callback(); return false; } catch (error) { return true; }
}

function selfTestMonthlyExcel_() {
  let spreadsheet = null;
  try {
    spreadsheet = SpreadsheetApp.create('Line Expense Self Test ' + Date.now());
    const sheet = spreadsheet.getSheets()[0];
    const layout = writeMonthlyBillExcelSheet_(sheet, [
      { vendor_name: 'A', notes: '', category_name: 'อื่นๆ', document_date: '2026-07-01', grand_total: 100.25, doc_type: 'RECEIPT', source_user_id: 'Tester' },
      { vendor_name: 'B', notes: '', category_name: 'อื่นๆ', document_date: '2026-07-02', grand_total: 250.5, doc_type: 'CASH_BILL', source_user_id: 'Tester' },
    ], parseExportMonth_('2026-07'));
    SpreadsheetApp.flush();
    return {
      formula: sheet.getRange(layout.totalRow, 6).getFormula(),
      total: toNumber_(sheet.getRange(layout.totalRow, 6).getValue()),
      countLabel: sheet.getRange(layout.totalRow, 7).getDisplayValue(),
    };
  } finally {
    if (spreadsheet) {
      try { DriveApp.getFileById(spreadsheet.getId()).setTrashed(true); } catch (ignored) { console.error(ignored); }
    }
  }
}
