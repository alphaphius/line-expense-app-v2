function initializeApiSecurity_() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(PROP_KEYS.LINE_WEBHOOK_KEY)) {
    properties.setProperty(PROP_KEYS.LINE_WEBHOOK_KEY, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  if (properties.getProperty(PROP_KEYS.API_PIN_HASH)) return;
  const salt = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  properties.setProperties({
    [PROP_KEYS.API_PIN_SALT]: salt,
    [PROP_KEYS.API_PIN_HASH]: hashApiPin_('1234', salt),
    [PROP_KEYS.API_PIN_MUST_CHANGE]: 'true',
    [PROP_KEYS.API_SESSION_VERSION]: '1',
  }, false);
}

function verifyApiPin(pin, deviceId) {
  initializeApiSecurity_();
  const safeDeviceId = normalizeDeviceId_(deviceId);
  const throttleKey = apiThrottleKey_(safeDeviceId);
  const cache = CacheService.getScriptCache();
  const attempts = Number(cache.get(throttleKey) || 0);
  if (attempts >= APP_CONFIG.API_RATE_LIMIT_ATTEMPTS) {
    logSecurityEvent_('PIN_LOCKOUT', safeDeviceId, false, 'too_many_attempts');
    throw apiError_('AUTH_LOCKED', 'ลองรหัสหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
  }

  const properties = PropertiesService.getScriptProperties();
  const salt = properties.getProperty(PROP_KEYS.API_PIN_SALT) || '';
  const actual = hashApiPin_(cleanString_(pin, 32), salt);
  const expected = properties.getProperty(PROP_KEYS.API_PIN_HASH) || '';
  if (!constantTimeEquals_(actual, expected)) {
    cache.put(throttleKey, String(attempts + 1), APP_CONFIG.API_RATE_LIMIT_WINDOW_SECONDS);
    logSecurityEvent_('PIN_VERIFY', safeDeviceId, false, 'invalid_pin');
    throw apiError_('AUTH_INVALID', 'รหัสไม่ถูกต้อง');
  }

  cache.remove(throttleKey);
  const session = issueApiSession_(safeDeviceId, false);
  logSecurityEvent_('PIN_VERIFY', safeDeviceId, true, 'session_issued');
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    pinMustChange: properties.getProperty(PROP_KEYS.API_PIN_MUST_CHANGE) === 'true',
  };
}

function changeApiPin(sessionToken, currentPin, nextPin, deviceId) {
  const session = requireApiSession_(sessionToken, false);
  const safeDeviceId = normalizeDeviceId_(deviceId || session.deviceId);
  const properties = PropertiesService.getScriptProperties();
  const salt = properties.getProperty(PROP_KEYS.API_PIN_SALT) || '';
  if (!constantTimeEquals_(hashApiPin_(cleanString_(currentPin, 32), salt), properties.getProperty(PROP_KEYS.API_PIN_HASH) || '')) {
    logSecurityEvent_('PIN_CHANGE', safeDeviceId, false, 'invalid_current_pin');
    throw apiError_('AUTH_INVALID', 'รหัสเดิมไม่ถูกต้อง');
  }
  const next = cleanString_(nextPin, 32);
  if (!/^\d{4,8}$/.test(next)) throw apiError_('VALIDATION', 'รหัสใหม่ต้องเป็นตัวเลข 4–8 หลัก');
  if (next === '1234') throw apiError_('VALIDATION', 'กรุณาเปลี่ยนจากรหัสเริ่มต้น 1234');

  const nextSalt = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const sessionVersion = Number(properties.getProperty(PROP_KEYS.API_SESSION_VERSION) || 1) + 1;
  properties.setProperties({
    [PROP_KEYS.API_PIN_SALT]: nextSalt,
    [PROP_KEYS.API_PIN_HASH]: hashApiPin_(next, nextSalt),
    [PROP_KEYS.API_PIN_MUST_CHANGE]: 'false',
    [PROP_KEYS.API_SESSION_VERSION]: String(sessionVersion),
  }, false);
  const replacement = issueApiSession_(safeDeviceId, false);
  logSecurityEvent_('PIN_CHANGE', safeDeviceId, true, 'pin_rotated');
  return { token: replacement.token, expiresAt: replacement.expiresAt, pinMustChange: false };
}

function issueApiSession_(deviceId, privileged) {
  const token = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + ':' + new Date().getTime() + ':' + Math.random()
  )).replace(/=+$/, '');
  const now = new Date().getTime();
  const ttl = privileged ? APP_CONFIG.API_PRIVILEGED_SECONDS : APP_CONFIG.API_SESSION_SECONDS;
  const session = {
    deviceId: normalizeDeviceId_(deviceId),
    issuedAt: now,
    expiresAt: now + ttl * 1000,
    privileged: !!privileged,
    version: Number(getScriptProperty_(PROP_KEYS.API_SESSION_VERSION, false) || 1),
  };
  CacheService.getScriptCache().put(apiSessionKey_(token), JSON.stringify(session), ttl);
  return { token: token, expiresAt: session.expiresAt };
}

function requireApiSession_(token, privileged) {
  const safeToken = cleanString_(token, 200);
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(safeToken)) throw apiError_('AUTH_REQUIRED', 'กรุณาเข้าสู่ระบบใหม่');
  const raw = CacheService.getScriptCache().get(apiSessionKey_(safeToken));
  if (!raw) throw apiError_('AUTH_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const session = JSON.parse(raw);
  if (Number(session.expiresAt) <= new Date().getTime()) throw apiError_('AUTH_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const currentVersion = Number(getScriptProperty_(PROP_KEYS.API_SESSION_VERSION, false) || 1);
  if (Number(session.version) !== currentVersion) throw apiError_('AUTH_EXPIRED', 'รหัสเข้าถึงมีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
  if (privileged && !session.privileged) throw apiError_('REAUTH_REQUIRED', 'กรุณายืนยันรหัสอีกครั้ง');
  return session;
}

function apiSessionKey_(token) {
  return 'API_SESSION_' + sha256Hex_(token).slice(0, 48);
}

function apiThrottleKey_(deviceId) {
  return 'API_PIN_FAIL_' + sha256Hex_(deviceId).slice(0, 32);
}

function hashApiPin_(pin, salt) {
  let value = cleanString_(salt) + ':' + cleanString_(pin, 32);
  for (let index = 0; index < 1200; index += 1) value = sha256Hex_(value + ':' + salt);
  return value;
}

function constantTimeEquals_(left, right) {
  left = cleanString_(left);
  right = cleanString_(right);
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function normalizeDeviceId_(value) {
  const id = cleanString_(value, 120).replace(/[^A-Za-z0-9_-]/g, '');
  return id.length >= 16 ? id : 'unknown-device';
}

function logSecurityEvent_(eventType, deviceId, success, detail) {
  try {
    appendObject_(SHEETS.SECURITY, {
      event_id: uuid_(), event_type: cleanString_(eventType, 60), device_id: normalizeDeviceId_(deviceId),
      success: !!success, detail: cleanString_(detail, 200), created_at: nowIso_(),
    });
  } catch (error) {
    console.error('Security log: ' + error.message);
  }
}

function apiError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
