function initializeApiSecurity_() {
  const properties = PropertiesService.getScriptProperties();
  const defaults = {};
  if (!properties.getProperty(PROP_KEYS.LINE_WEBHOOK_KEY)) {
    defaults[PROP_KEYS.LINE_WEBHOOK_KEY] = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }
  if (!properties.getProperty(PROP_KEYS.API_SESSION_VERSION)) defaults[PROP_KEYS.API_SESSION_VERSION] = '1';
  if (Object.keys(defaults).length) properties.setProperties(defaults, false);
}

function openApiSession(deviceId) {
  initializeApiSecurity_();
  const safeDeviceId = normalizeDeviceId_(deviceId);
  const session = issueApiSession_(safeDeviceId);
  logSecurityEvent_('OPEN_SESSION', safeDeviceId, true, 'session_issued');
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    accessMode: 'OPEN',
  };
}

function issueApiSession_(deviceId) {
  const token = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + ':' + new Date().getTime() + ':' + Math.random()
  )).replace(/=+$/, '');
  const now = new Date().getTime();
  const ttl = APP_CONFIG.API_SESSION_SECONDS;
  const session = {
    deviceId: normalizeDeviceId_(deviceId),
    issuedAt: now,
    expiresAt: now + ttl * 1000,
    version: Number(getScriptProperty_(PROP_KEYS.API_SESSION_VERSION, false) || 1),
  };
  CacheService.getScriptCache().put(apiSessionKey_(token), JSON.stringify(session), ttl);
  return { token: token, expiresAt: session.expiresAt };
}

function requireApiSession_(token) {
  const safeToken = cleanString_(token, 200);
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(safeToken)) throw apiError_('AUTH_REQUIRED', 'กำลังเชื่อมต่อเซสชันใหม่');
  const raw = CacheService.getScriptCache().get(apiSessionKey_(safeToken));
  if (!raw) throw apiError_('AUTH_EXPIRED', 'เซสชันหมดอายุ กำลังเชื่อมต่อใหม่');
  const session = JSON.parse(raw);
  if (Number(session.expiresAt) <= new Date().getTime()) throw apiError_('AUTH_EXPIRED', 'เซสชันหมดอายุ กำลังเชื่อมต่อใหม่');
  const currentVersion = Number(getScriptProperty_(PROP_KEYS.API_SESSION_VERSION, false) || 1);
  if (Number(session.version) !== currentVersion) throw apiError_('AUTH_EXPIRED', 'เซสชันมีการเปลี่ยนแปลง กำลังเชื่อมต่อใหม่');
  return session;
}

function apiSessionKey_(token) {
  return 'API_SESSION_' + sha256Hex_(token).slice(0, 48);
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
