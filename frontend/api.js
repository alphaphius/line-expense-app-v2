(function () {
  'use strict';

  const config = window.LINE_EXPENSE_CONFIG || {};
  const keys = {
    endpoint: 'line-expense-v2-api-endpoint',
    session: 'line-expense-v2-session',
    device: 'line-expense-v2-device',
  };
  let endpoint = normalizeEndpoint(config.apiEndpoint || localStorage.getItem(keys.endpoint) || '');
  let session = readSession();
  const longActions = ['submitBillPages', 'exportMonthlyBillWord', 'exportMonthlyBillExcel', 'backfillLineUsernames'];

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function normalizeEndpoint(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (!url) return '';
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

  async function request(action, args, options) {
    options = options || {};
    if (!endpoint) throw new Error('ยังไม่ได้ตั้งค่า Apps Script Web App URL');
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
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Backend ตอบกลับ HTTP ' + response.status);
      const result = await response.json();
      if (!result || result.ok !== true) {
        const error = new Error(result && result.error && result.error.message || 'Backend ตอบกลับไม่ถูกต้อง');
        error.code = result && result.error && result.error.code || 'API_ERROR';
        throw error;
      }
      return result.data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('การเชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
      if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
        throw new Error('เชื่อมต่อ Apps Script ไม่สำเร็จ กรุณาตรวจ URL, Deployment และอินเทอร์เน็ต');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function promptEndpoint() {
    const result = await Swal.fire({
      title: 'เชื่อมต่อ Backend V2',
      html: '<label class="block text-left text-sm">Apps Script Web App URL<input id="api-endpoint-input" type="url" class="swal2-input !mx-0 !mt-2 !w-full" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="url"></label><p class="mt-3 text-left text-xs text-slate-500">URL จะเก็บเฉพาะในอุปกรณ์นี้ และต้องเป็น Deployment V2 เท่านั้น</p>',
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

  async function promptPin(health) {
    const result = await Swal.fire({
      title: health && health.pinMustChange ? 'เข้าสู่ระบบครั้งแรก' : 'เข้าสู่ระบบ',
      html: '<label class="block text-left text-sm">รหัส PIN<input id="api-pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" class="swal2-input !mx-0 !mt-2 !w-full" autocomplete="current-password"></label>' + (health && health.pinMustChange ? '<p class="mt-3 text-left text-xs text-amber-700">ครั้งแรกใช้ 1234 แล้วระบบจะให้ตั้งรหัสใหม่ทันที</p>' : ''),
      confirmButtonText: 'เข้าสู่ระบบ',
      confirmButtonColor: '#8f5f42',
      allowOutsideClick: false,
      allowEscapeKey: false,
      preConfirm: async () => {
        const pin = document.getElementById('api-pin-input').value;
        if (!/^\d{4,8}$/.test(pin)) return Swal.showValidationMessage('กรุณากรอกตัวเลข 4–8 หลัก');
        try { return { pin, auth: await request('verifyPin', [pin, getDeviceId()]) }; }
        catch (error) { Swal.showValidationMessage(error.message); return false; }
      },
    });
    saveSession({ token: result.value.auth.token, expiresAt: result.value.auth.expiresAt });
    if (result.value.auth.pinMustChange) await forcePinChange(result.value.pin);
  }

  async function forcePinChange(currentPin) {
    const result = await Swal.fire({
      title: 'ตั้งรหัส PIN ใหม่',
      html: '<label class="block text-left text-sm">รหัสใหม่ 4–8 หลัก<input id="api-new-pin" type="password" inputmode="numeric" maxlength="8" class="swal2-input !mx-0 !mt-2 !w-full" autocomplete="new-password"></label><label class="mt-3 block text-left text-sm">ยืนยันรหัสใหม่<input id="api-new-pin-confirm" type="password" inputmode="numeric" maxlength="8" class="swal2-input !mx-0 !mt-2 !w-full" autocomplete="new-password"></label>',
      confirmButtonText: 'บันทึกรหัสใหม่',
      confirmButtonColor: '#8f5f42',
      allowOutsideClick: false,
      allowEscapeKey: false,
      preConfirm: async () => {
        const nextPin = document.getElementById('api-new-pin').value;
        const confirmation = document.getElementById('api-new-pin-confirm').value;
        if (!/^\d{4,8}$/.test(nextPin)) return Swal.showValidationMessage('รหัสใหม่ต้องเป็นตัวเลข 4–8 หลัก');
        if (nextPin === '1234') return Swal.showValidationMessage('กรุณาเปลี่ยนจากรหัสเริ่มต้น 1234');
        if (nextPin !== confirmation) return Swal.showValidationMessage('รหัสยืนยันไม่ตรงกัน');
        try { return await request('changePin', [currentPin, nextPin, getDeviceId()]); }
        catch (error) { Swal.showValidationMessage(error.message); return false; }
      },
    });
    saveSession({ token: result.value.token, expiresAt: result.value.expiresAt });
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
    if (!session || Number(session.expiresAt) <= Date.now()) await promptPin(health);
    window.INITIAL_BILL_ID = new URLSearchParams(location.search).get('bill_id') || '';
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
        const health = await request('health', []);
        await promptPin(health);
        return request(action, args, { requestId: requestId });
      }
      throw error;
    }
  }

  async function call(action) {
    const args = Array.prototype.slice.call(arguments, 1);
    return callWithRequestId.apply(null, [action, uuid().replace(/-/g, '')].concat(args));
  }

  window.V2Api = Object.freeze({ call, callWithRequestId, connect, newRequestId: () => uuid().replace(/-/g, ''), getEndpoint: () => endpoint });
})();
