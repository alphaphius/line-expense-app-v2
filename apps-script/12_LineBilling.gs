function processStoredLineSession_(sessionId) {
  const session = findById_(SHEETS.SESSIONS, 'session_id', sessionId);
  if (!session) throw new Error('ไม่พบ Upload Session');
  const project = findById_(SHEETS.PROJECTS, 'project_id', session.project_id);
  const targetCompany = findById_(SHEETS.COMPANIES, 'company_id', session.company_id);
  if (!project || !targetCompany) throw new Error('ข้อมูลโครงการหรือบริษัทไม่ครบ');
  const documents = getRows_(SHEETS.DOCUMENTS)
    .filter(function (row) { return row.session_id === sessionId; })
    .sort(function (a, b) { return toNumber_(a.page_no) - toNumber_(b.page_no); });
  if (!documents.length) throw new Error('ไม่พบไฟล์รูปใน Session');
  if (toNumber_(session.expected_pages) !== documents.length) throw new Error('จำนวนไฟล์ยังไม่ครบตามที่ระบุ');

  const billId = uuid_();
  const timestamp = nowIso_();
  const blobs = documents.map(function (document) { return DriveApp.getFileById(document.file_id).getBlob(); });
  const companies = publicRows_(SHEETS.COMPANIES).filter(function (row) { return toBoolean_(row.active); });
  const categories = publicRows_(SHEETS.CATEGORIES).filter(function (row) { return toBoolean_(row.active); });
  const receivedDate = toIsoDate_(cleanString_(session.created_at).slice(0, 10)) || timestamp.slice(0, 10);
  const ai = analyzeBillBlobs_(blobs, { companies: companies, categories: categories, billId: billId, receivedDate: receivedDate });
  optimizeStoredLineDocuments_(documents);
  const vendor = upsertVendor_(ai);
  const selectedCompanyTax = normalizeTaxId_(targetCompany.tax_id);
  const buyerTax = normalizeTaxId_(ai.buyer_tax_id);
  const taxMatch = !!selectedCompanyTax && selectedCompanyTax === buyerTax;
  const companyNameMatch = String(ai.company_id) === String(targetCompany.company_id) || normalizeThaiText_(ai.buyer_name) === normalizeThaiText_(targetCompany.company_name);
  const addressMatch = isAddressMatch_(ai.buyer_address, targetCompany.address);
  const duplicateKey = [normalizeTaxId_(ai.vendor_tax_id) || normalizeThaiText_(ai.vendor_name), cleanString_(ai.document_no), ai.document_date, toNumber_(ai.grand_total).toFixed(2)].join('|');
  const duplicate = getRows_(SHEETS.BILLS).find(function (row) { return row.duplicate_key === duplicateKey && row.status !== 'REJECTED'; });
  if (duplicate) {
    ai.needs_review = true;
    ai.review_reasons.push('อาจเป็นบิลซ้ำกับเลขที่ ' + duplicate.bill_id);
  }
  if (!taxMatch) {
    ai.needs_review = true;
    ai.review_reasons.push('เลขผู้เสียภาษีผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
  }
  if (!addressMatch) {
    ai.needs_review = true;
    ai.review_reasons.push('ที่อยู่ผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
  }

  const bill = {
    bill_id: billId, session_id: sessionId, project_id: project.project_id, company_id: targetCompany.company_id,
    category_id: ai.category_id, doc_type: ai.doc_type, document_no: cleanString_(ai.document_no, 100),
    document_date: ai.document_date, due_date: ai.due_date, vendor_id: vendor.vendor_id,
    vendor_name: cleanString_(ai.vendor_name, 200), vendor_tax_id: normalizeTaxId_(ai.vendor_tax_id),
    vendor_branch: cleanString_(ai.vendor_branch, 100), vendor_address: cleanString_(ai.vendor_address, 500),
    buyer_name: cleanString_(ai.buyer_name, 200), buyer_tax_id: buyerTax, buyer_address: cleanString_(ai.buyer_address, 500),
    currency: cleanString_(ai.currency || 'THB', 10), subtotal: toNumber_(ai.subtotal), discount: toNumber_(ai.discount),
    vat_rate: toNumber_(ai.vat_rate), vat_amount: toNumber_(ai.vat_amount), withholding_tax: toNumber_(ai.withholding_tax),
    grand_total: toNumber_(ai.grand_total), payment_method: cleanString_(ai.payment_method, 100),
    description: cleanString_(ai.description, 500), notes: cleanString_(ai.notes, 1000), page_count: documents.length,
    image_quality: ai.image_quality, quality_score: ai.quality_score, needs_review: ai.needs_review,
    review_reasons: ai.review_reasons.join(' | '), company_match: companyNameMatch,
    tax_id_match: taxMatch, duplicate_key: duplicateKey, status: ai.needs_review ? 'NEEDS_REVIEW' : 'PENDING_CONFIRMATION',
    source: 'LINE', source_user_id: getLineDisplayName_(session.source_user_id, session.source_context_id), folder_path: folderPathFor_(project.project_name, todayIso_()),
    created_at: timestamp, updated_at: timestamp, confirmed_at: '', address_match: addressMatch, source_context_id: cleanString_(session.source_context_id),
  };
  appendObject_(SHEETS.BILLS, bill);
  appendObjects_(SHEETS.ITEMS, (ai.items || []).map(function (item, index) {
    return {
      item_id: uuid_(), bill_id: billId, line_no: index + 1, description: cleanString_(item.description, 300),
      quantity: toNumber_(item.quantity), unit: cleanString_(item.unit, 50), unit_price: toNumber_(item.unit_price),
      discount: toNumber_(item.discount), vat_amount: toNumber_(item.vat_amount), amount: toNumber_(item.amount), sku: cleanString_(item.sku, 100),
    };
  }));
  documents.forEach(function (document) { updateObjectById_(SHEETS.DOCUMENTS, 'doc_id', document.doc_id, { bill_id: billId }); });
  updateObjectById_(SHEETS.SESSIONS, 'session_id', sessionId, { status: 'READY', updated_at: nowIso_() });
  appendAudit_('bill', billId, 'LINE_AI_EXTRACT', null, bill, session.source_user_id);
  return getBillDetail_(billId);
}

function shouldPushSavedFlexAfterConfirm_(actor, bill, newlyConfirmed) {
  return !!newlyConfirmed
    && cleanString_(actor || 'WEB').toUpperCase() === 'WEB'
    && cleanString_(bill && bill.source).toUpperCase() === 'LINE'
    && !!cleanString_(bill && bill.session_id);
}

function resolveOriginalLineUserId_(bill, session) {
  if (!bill || !session) return '';
  if (cleanString_(bill.source).toUpperCase() !== 'LINE') return '';
  if (cleanString_(session.source).toUpperCase() !== 'LINE') return '';
  if (!cleanString_(bill.session_id) || cleanString_(bill.session_id) !== cleanString_(session.session_id)) return '';
  const contextId = cleanString_(session.source_context_id, 100);
  if (/^[CR][0-9a-f]{20,64}$/i.test(contextId)) return contextId;
  const userId = cleanString_(session.source_user_id, 100);
  return /^U[0-9a-f]{20,64}$/i.test(userId) ? userId : '';
}

function pushBillSavedFlexToOriginalLineUser_(bill) {
  if (!bill || !bill.bill_id || !bill.session_id) return false;
  const session = findById_(SHEETS.SESSIONS, 'session_id', bill.session_id);
  const userId = resolveOriginalLineUserId_(bill, session);
  if (!userId) {
    console.warn('ข้ามการส่ง Flex: ไม่พบ LINE ห้องต้นทางของบิล ' + cleanString_(bill.bill_id));
    return false;
  }
  pushLine_(userId, [buildBillSavedFlex(bill)]);
  return true;
}

function diagnoseLineIntegration() {
  const result = {
    tested_at: nowIso_(),
    web_app_url: ScriptApp.getService().getUrl() || '',
    android_external_url: '',
    frontend_url: getScriptProperty_(PROP_KEYS.FRONTEND_URL, false),
    line_token_configured: !!getScriptProperty_(PROP_KEYS.LINE_ACCESS_TOKEN, false),
    gemini_key_configured: !!getScriptProperty_(PROP_KEYS.GEMINI_API_KEY, false),
    liff_property: getScriptProperty_(PROP_KEYS.LIFF_ID, false) || APP_CONFIG.DEFAULT_LIFF_ID,
    liff_url: getLiffUrl_(),
    bot: null,
    webhook: null,
    rich_menus: [],
    warnings: [],
  };
  result.android_external_url = result.frontend_url ? result.frontend_url + '?openExternalBrowser=1' : '';
  if (!result.line_token_configured) {
    result.warnings.push('ยังไม่ได้ตั้ง LINE_ACCESS_TOKEN ใน Script Properties');
    return result;
  }
  try { result.bot = callLineApi_('https://api.line.me/v2/bot/info', 'get'); } catch (error) { result.warnings.push(error.message); }
  try {
    result.webhook = callLineApi_('https://api.line.me/v2/bot/channel/webhook/endpoint', 'get');
    if (result.webhook.endpoint && /\/dev(?:\?|$)/.test(result.webhook.endpoint)) result.warnings.push('Webhook ใช้ URL /dev ต้องเปลี่ยนเป็น /exec');
    if (result.webhook.endpoint && result.web_app_url && result.webhook.endpoint.indexOf(result.web_app_url) !== 0) result.warnings.push('Webhook URL ใน LINE ไม่ตรงกับ Web App URL ของ deployment ปัจจุบัน');
  } catch (error) { result.warnings.push(error.message); }
  try {
    const richMenuResponse = callLineApi_('https://api.line.me/v2/bot/richmenu/list', 'get');
    result.rich_menus = (richMenuResponse.richmenus || []).map(function (menu) {
      const uris = [];
      (menu.areas || []).forEach(function (area) { if (area.action && area.action.type === 'uri') uris.push(area.action.uri); });
      uris.forEach(function (uri) {
        if (/drive\.google\.com/i.test(uri)) result.warnings.push('Rich Menu ชี้ไป Google Drive แทน LIFF: ' + uri);
        if (/script\.google\.com.*\/dev/i.test(uri)) result.warnings.push('Rich Menu ชี้ Web App /dev: ' + uri);
        if (/script\.google\.com\/macros\/u\/\d+\/s\//i.test(uri)) result.warnings.push('Rich Menu บันทึก URL แบบ /u/เลขบัญชี/ ต้องเปลี่ยนเป็น LIFF URL: ' + uri);
        if (/script\.google\.com\/macros\/s\//i.test(uri)) result.warnings.push('Rich Menu ชี้ Apps Script โดยตรง ควรใช้ ' + result.liff_url);
        if (!/^https:\/\//i.test(uri)) result.warnings.push('Rich Menu URL ไม่มี https://: ' + uri);
      });
      return { richMenuId: menu.richMenuId, name: menu.name, chatBarText: menu.chatBarText, uri_actions: uris };
    });
  } catch (error) { result.warnings.push(error.message); }
  if (!result.liff_url) result.warnings.push('ยังไม่ได้ตั้ง LIFF_ID ใน Script Properties');
  return result;
}

function diagnoseGeminiIntegration() {
  const apiKey = getScriptProperty_(PROP_KEYS.GEMINI_API_KEY, false);
  const result = { configured: !!apiKey, valid: false, model: APP_CONFIG.GEMINI_MODEL, message: '' };
  if (!apiKey) {
    result.message = 'ยังไม่ได้ตั้ง GEMINI_API_KEY ใน Script Properties';
    return result;
  }
  try {
    const response = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(APP_CONFIG.GEMINI_MODEL), {
      method: 'get', headers: { 'x-goog-api-key': apiKey }, muteHttpExceptions: true,
    });
    const body = JSON.parse(response.getContentText() || '{}');
    result.valid = response.getResponseCode() === 200;
    result.message = result.valid ? 'API key ใช้งานได้' : cleanString_((body.error && body.error.message) || ('HTTP ' + response.getResponseCode()), 300);
  } catch (error) {
    result.message = cleanString_(error.message || error, 300);
  }
  return result;
}
