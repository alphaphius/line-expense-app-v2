function doGet(e) {
  return jsonOutput_(apiEnvelope_(true, apiHealth_(), null, requestIdFrom_(e)));
}

function doPost(e) {
  const requestId = requestIdFrom_(e);
  try {
    const bodyText = (e && e.postData && e.postData.contents) || '{}';
    const body = JSON.parse(bodyText);
    if (Array.isArray(body.events)) {
      validateLineWebhookKey_(e);
      handleLineWebhook_(e);
      return HtmlService.createHtmlOutput('OK');
    }
    return jsonOutput_(handleApiRequest_(body, requestId));
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonOutput_(apiEnvelope_(false, null, {
      code: cleanString_(error.code || 'SERVER_ERROR', 80),
      message: cleanString_(error.message || error, 500),
    }, requestId));
  }
}

function handleApiRequest_(request, requestId) {
  request = request || {};
  if (cleanString_(request.apiVersion) !== APP_CONFIG.API_VERSION) {
    throw apiError_('API_VERSION_MISMATCH', 'เวอร์ชันหน้าเว็บไม่ตรงกับ Backend กรุณารีโหลดหรืออัปเดตระบบ');
  }
  const action = cleanString_(request.action, 80);
  const args = Array.isArray(request.args) ? request.args : [];
  if (action === 'health') return apiEnvelope_(true, apiHealth_(), null, requestId);
  if (action === 'openSession') return apiEnvelope_(true, openApiSession(args[0]), null, requestId);

  const session = requireApiSession_(request.sessionToken);
  const handler = apiActionHandler_(action);
  if (!handler) throw apiError_('ACTION_NOT_ALLOWED', 'คำสั่งนี้ไม่ได้รับอนุญาต');

  const mutation = isMutationAction_(action);
  if (mutation) {
    const reservation = reserveMutation_(request.requestId, action, session.deviceId);
    if (reservation.completed) return apiEnvelope_(true, toClientSafe_(hydrateMutationResult_(reservation.data)), null, requestId);
  }

  try {
    const rawResult = handler(args);
    if (rawResult && rawResult.ok === false) throw apiError_('ACTION_FAILED', rawResult.error || 'ทำรายการไม่สำเร็จ');
    const data = rawResult && Object.prototype.hasOwnProperty.call(rawResult, 'data') ? rawResult.data : rawResult;
    if (mutation) storeMutationResult_(request.requestId, action, session.deviceId, data);
    return apiEnvelope_(true, toClientSafe_(data), null, requestId);
  } catch (error) {
    if (mutation) markMutationFailed_(request.requestId, action, session.deviceId, error);
    throw error;
  }
}

function apiActionHandler_(action) {
  const handlers = {
    getBootstrapData: function (args) { return getBootstrapData(args[0]); },
    getDashboard: function (args) { return getDashboard(args[0]); },
    listBills: function (args) { return listBills(args[0]); },
    listPendingReviewBills: function () { return listPendingReviewBills(); },
    getBillDetail: function (args) { return getBillDetail(args[0]); },
    getBillDocumentPreview: function (args) { return getBillDocumentPreview(args[0]); },
    submitBillPages: function (args) { return submitBillPages(args[0]); },
    updateBill: function (args) { return updateBill(args[0]); },
    confirmBill: function (args) { return confirmBill(args[0], args[1]); },
    deleteBill: function (args) { return deleteBill(args[0], args[1]); },
    restoreBill: function (args) { return restoreBill(args[0], args[1]); },
    saveMasterData: function (args) { return saveMasterData(args[0], args[1]); },
    deleteMasterData: function (args) { return deleteMasterData(args[0], args[1]); },
    getQuickSettings: function () { return getQuickSettings(); },
    saveQuickSettings: function (args) { return saveQuickSettings(args[0]); },
    clearQuickSettings: function (args) { return clearQuickSettings(args[0]); },
    getSystemStatus: function () { return getSystemStatus(); },
    verifyDatabaseAccess: function () { return verifyDatabaseAccess(); },
    backfillLineUsernames: function () { return backfillLineUsernames(); },
    exportMonthlyBillWord: function (args) { return exportMonthlyBillWord(args[0]); },
    exportMonthlyBillExcel: function (args) { return exportMonthlyBillExcel(args[0]); },
    getExportFileChunk: function (args) { return getExportFileChunk(args[0], args[1]); },
  };
  return handlers[action] || null;
}

function isMutationAction_(action) {
  return [
    'submitBillPages', 'updateBill', 'confirmBill', 'deleteBill', 'restoreBill',
    'saveMasterData', 'deleteMasterData', 'saveQuickSettings', 'clearQuickSettings', 'backfillLineUsernames',
  ].indexOf(action) >= 0;
}

function findMutationResult_(mutationId) {
  const id = cleanString_(mutationId, 160);
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) throw apiError_('INVALID_REQUEST_ID', 'Request ID ไม่ถูกต้อง');
  const cached = CacheService.getScriptCache().get('MUTATION_' + id);
  if (cached) return JSON.parse(cached);
  const row = findById_(SHEETS.MUTATIONS, 'mutation_id', id);
  return row && row.status === 'SUCCEEDED' && row.result_json ? hydrateMutationResult_(JSON.parse(row.result_json)) : null;
}

function reserveMutation_(mutationId, action, actor) {
  const id = cleanString_(mutationId, 160);
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) throw apiError_('INVALID_REQUEST_ID', 'Request ID ไม่ถูกต้อง');
  const cached = CacheService.getScriptCache().get('MUTATION_' + id);
  if (cached) return { completed: true, data: JSON.parse(cached) };
  return withScriptLock_(function () {
    const existing = findById_(SHEETS.MUTATIONS, 'mutation_id', id);
    if (existing && existing.status === 'SUCCEEDED' && existing.result_json) {
      return { completed: true, data: JSON.parse(existing.result_json) };
    }
    if (existing && existing.status === 'PROCESSING') {
      const ageMs = Date.now() - new Date(existing.created_at).getTime();
      if (Number.isFinite(ageMs) && ageMs < 8 * 60 * 1000) {
        throw apiError_('MUTATION_IN_PROGRESS', 'รายการเดิมกำลังประมวลผล กรุณารอสักครู่แล้วกดลองอีกครั้ง');
      }
    }
    const pending = {
      action: action, actor: cleanString_(actor, 120), status: 'PROCESSING', result_json: '',
      created_at: nowIso_(), completed_at: '',
    };
    if (existing) updateObjectById_(SHEETS.MUTATIONS, 'mutation_id', id, pending);
    else appendObject_(SHEETS.MUTATIONS, Object.assign({ mutation_id: id }, pending));
    return { completed: false };
  });
}

function storeMutationResult_(mutationId, action, actor, data) {
  const id = cleanString_(mutationId, 160);
  const storedData = compactMutationResult_(action, data);
  const resultJson = safeJson_(storedData);
  const clientJson = safeJson_(data);
  if (clientJson.length <= 90000) CacheService.getScriptCache().put('MUTATION_' + id, clientJson, 21600);
  updateObjectById_(SHEETS.MUTATIONS, 'mutation_id', id, {
    action: action, actor: cleanString_(actor, 120), status: 'SUCCEEDED',
    result_json: resultJson.length <= 45000 ? resultJson : safeJson_({ __mutation_ref: 'ack' }), completed_at: nowIso_(),
  });
}

function markMutationFailed_(mutationId, action, actor, error) {
  try {
    if (CacheService.getScriptCache().get('MUTATION_' + cleanString_(mutationId, 160))) return;
    updateObjectById_(SHEETS.MUTATIONS, 'mutation_id', cleanString_(mutationId, 160), {
      action: action, actor: cleanString_(actor, 120), status: 'FAILED',
      result_json: safeJson_({ message: cleanString_(error && error.message || error, 500) }), completed_at: nowIso_(),
    });
  } catch (logError) {
    console.error('Mutation failure log: ' + logError.message);
  }
}

function compactMutationResult_(action, data) {
  const billActions = ['submitBillPages', 'updateBill', 'confirmBill', 'deleteBill', 'restoreBill'];
  if (billActions.indexOf(action) >= 0 && data && data.bill_id) {
    return { __mutation_ref: 'bill', bill_id: cleanString_(data.bill_id, 160) };
  }
  return data;
}

function hydrateMutationResult_(data) {
  if (data && data.__mutation_ref === 'bill' && data.bill_id) return getBillDetail_(data.bill_id);
  return data;
}

function apiHealth_() {
  initializeApiSecurity_();
  const properties = PropertiesService.getScriptProperties();
  return {
    appName: APP_CONFIG.APP_NAME,
    appVersion: APP_CONFIG.VERSION,
    apiVersion: APP_CONFIG.API_VERSION,
    schemaVersion: APP_CONFIG.SCHEMA_VERSION,
    serverTime: nowIso_(),
    accessMode: 'OPEN',
    loginRequired: false,
    sessionRequired: false,
    pinMustChange: false,
    liffId: properties.getProperty(PROP_KEYS.LIFF_ID) || '',
    frontendUrl: properties.getProperty(PROP_KEYS.FRONTEND_URL) || '',
  };
}

function apiEnvelope_(ok, data, error, requestId) {
  return {
    ok: !!ok,
    data: data == null ? null : data,
    error: error || null,
    requestId: requestId || Utilities.getUuid(),
    serverTime: nowIso_(),
    apiVersion: APP_CONFIG.API_VERSION,
  };
}

function requestIdFrom_(e) {
  return cleanString_(e && e.parameter && e.parameter.requestId, 160) || Utilities.getUuid();
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function validateLineWebhookKey_(e) {
  const expected = getScriptProperty_(PROP_KEYS.LINE_WEBHOOK_KEY, false);
  if (!expected) return;
  const actual = cleanString_(e && e.parameter && e.parameter.hook, 200);
  if (!constantTimeEquals_(sha256Hex_(actual), sha256Hex_(expected))) throw apiError_('LINE_WEBHOOK_FORBIDDEN', 'Webhook key ไม่ถูกต้อง');
}
