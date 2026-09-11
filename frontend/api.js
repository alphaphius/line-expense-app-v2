(function () {
  'use strict';

  const config = window.LINE_EXPENSE_CONFIG || {};
  const keys = {
    endpoint: 'line-expense-v2-api-endpoint',
    session: 'line-expense-v2-session',
    protectedSession: 'phius-workhub-protected-session',
    device: 'line-expense-v2-device',
  };
  let endpoint = normalizeEndpoint(config.apiEndpoint || localStorage.getItem(keys.endpoint) || '/api');
  let session = readSession();
  let protectedSession = readProtectedSession();
  const longActions = ['submitBillPages', 'exportMonthlyBillWord', 'exportMonthlyBillExcel', 'backfillLineUsernames', 'saveReceiptTemplate', 'queueReceiptCard', 'processReceiptBatchAI', 'saveReceiptCardDraft', 'exportReceiptDocuments', 'exportReceiptRosterExcel'];

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function normalizeEndpoint(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    if (url === '/api') return url;
    if (/^https?:\/\//i.test(url)) {
      const parsed = new URL(url);
      if (parsed.origin === location.origin && parsed.pathname === '/api') return parsed.origin + '/api';
    }
    const localPreview = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && url === location.origin + '/__mock_api__';
    if (localPreview) return url;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/i.test(url)) {
      throw new Error('กรุณาใช้ Apps Script Web App URL ที่ลงท้ายด้วย /exec');
    }
    return url;
  }

  function getDeviceId() {
    let value = localStorage.getItem(keys.device);
    if (!value) {
      value = uuid().replace(/-/g, '');
      localStorage.setItem(keys.device, value);
    }
    return value;
  }

  function readSession() {
    try {
      const value = JSON.parse(sessionStorage.getItem(keys.session) || 'null');
      return value && Number(value.expiresAt) > Date.now() ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(value) {
    session = value;
    if (value) sessionStorage.setItem(keys.session, JSON.stringify(value));
    else sessionStorage.removeItem(keys.session);
  }

  function readProtectedSession() {
    try {
      const value = JSON.parse(localStorage.getItem(keys.protectedSession) || 'null');
      return value && Number(value.expiresAt) > Date.now() ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveProtectedSession(value) {
    protectedSession = value;
    if (value) localStorage.setItem(keys.protectedSession, JSON.stringify(value));
    else localStorage.removeItem(keys.protectedSession);
  }

  async function request(action, args, options) {
    options = options || {};
    if (!endpoint) throw new Error('ยังไม่ได้ตั้งค่า Backend URL');
    const requestId = options.requestId || uuid().replace(/-/g, '');
    const controller = new AbortController();
    const timeoutMs = longActions.indexOf(action) >= 0
      ? Number(config.longRequestTimeoutMs) || 330000
      : Number(config.requestTimeoutMs) || 90000;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint + '?requestId=' + encodeURIComponent(requestId), {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          apiVersion: config.apiVersion || '2.0',
          action: action,
          args: args || [],
          requestId: requestId,
          sessionToken: session && session.token || '',
          protectedToken: protectedSession && protectedSession.token || '',
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(result && result.error && result.error.message || 'Backend ตอบกลับ HTTP ' + response.status);
        error.code = result && result.error && result.error.code || 'HTTP_' + response.status;
        throw error;
      }
      if (!result || result.ok !== true) {
        const error = new Error(result && result.error && result.error.message || 'Backend ตอบกลับไม่ถูกต้อง');
        error.code = result && result.error && result.error.code || 'API_ERROR';
        throw error;
      }
      return result.data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('การเชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
      if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
        throw new Error('เชื่อมต่อ WorkHub Backend ไม่สำเร็จ กรุณาตรวจ NAS, URL และเครือข่าย');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function promptEndpoint() {
    const result = await Swal.fire({
      title: 'เชื่อมต่อ WorkHub Backend',
      html: '<label class="block text-left text-sm">Backend URL<input id="api-endpoint-input" type="text" class="swal2-input !mx-0 !mt-2 !w-full" placeholder="/api" autocomplete="url"></label><p class="mt-3 text-left text-xs text-slate-500">เมื่อติดตั้งบน NAS ให้ใช้ /api ซึ่งทำงานผ่านโดเมนเดียวกับหน้าเว็บ</p>',
      confirmButtonText: 'ทดสอบการเชื่อมต่อ',
      confirmButtonColor: '#8f5f42',
      allowOutsideClick: false,
      allowEscapeKey: false,
      preConfirm: () => {
        try { return normalizeEndpoint(document.getElementById('api-endpoint-input').value); }
        catch (error) { Swal.showValidationMessage(error.message); return false; }
      },
    });
    endpoint = result.value;
    localStorage.setItem(keys.endpoint, endpoint);
  }

  async function startOpenSession() {
    const openSession = await request('openSession', [getDeviceId()]);
    saveSession({ token: openSession.token, expiresAt: openSession.expiresAt });
    return openSession;
  }

  async function connect() {
    if (!endpoint) await promptEndpoint();
    let health;
    try {
      health = await request('health', []);
    } catch (error) {
      localStorage.removeItem(keys.endpoint);
      endpoint = '';
      await Swal.fire({ icon: 'error', title: 'เชื่อมต่อไม่สำเร็จ', text: error.message, confirmButtonText: 'ตั้งค่าใหม่', confirmButtonColor: '#8f5f42' });
      return connect();
    }
    if (!session || Number(session.expiresAt) <= Date.now()) await startOpenSession();
    window.INITIAL_BILL_ID = new URLSearchParams(location.search).get('bill_id') || '';
    window.INITIAL_BILL_EDIT = new URLSearchParams(location.search).get('edit') === '1';
    window.AUTO_REVIEW_BILL_ID = '';
    window.OPEN_EXTERNAL_BROWSER = new URLSearchParams(location.search).get('openExternalBrowser') === '1';
    return health;
  }

  async function callWithRequestId(action, requestId) {
    const args = Array.prototype.slice.call(arguments, 2);
    try {
      return await request(action, args, { requestId: requestId });
    } catch (error) {
      if (['AUTH_REQUIRED', 'AUTH_EXPIRED'].indexOf(error.code) >= 0) {
        saveSession(null);
        await startOpenSession();
        return request(action, args, { requestId: requestId });
      }
      if (['PROTECTED_AUTH_REQUIRED', 'PROTECTED_AUTH_EXPIRED'].indexOf(error.code) >= 0) saveProtectedSession(null);
      throw error;
    }
  }

  async function call(action) {
    const args = Array.prototype.slice.call(arguments, 1);
    return callWithRequestId.apply(null, [action, uuid().replace(/-/g, '')].concat(args));
  }

  async function unlockProtected(password) {
    const value = await call('openProtectedSession', password);
    saveProtectedSession({ token: value.token, expiresAt: value.expiresAt });
    return value;
  }

  window.V2Api = Object.freeze({
    call, callWithRequestId, connect, unlockProtected,
    hasProtectedSession: () => !!protectedSession && Number(protectedSession.expiresAt) > Date.now(),
    clearProtectedSession: () => saveProtectedSession(null),
    newRequestId: () => uuid().replace(/-/g, ''), getEndpoint: () => endpoint,
  });
})();
