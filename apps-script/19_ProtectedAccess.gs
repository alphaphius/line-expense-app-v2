function configureProtectedAccessPassword(password) {
  const cleanPassword = String(password == null ? '' : password);
  if (cleanPassword.length < 8 || cleanPassword.length > 128) throw apiError_('PASSWORD_POLICY', 'รหัสผ่านต้องมี 8-128 ตัวอักษร');
  const properties = PropertiesService.getScriptProperties();
  const salt = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const version = Number(properties.getProperty(PROP_KEYS.PROTECTED_SESSION_VERSION) || 0) + 1;
  properties.setProperties({
    PROTECTED_PASSWORD_SALT: salt,
    PROTECTED_PASSWORD_HASH: deriveProtectedPasswordHash_(cleanPassword, salt, APP_CONFIG.PROTECTED_HASH_ROUNDS),
    PROTECTED_PASSWORD_HASH_ROUNDS: String(APP_CONFIG.PROTECTED_HASH_ROUNDS),
    PROTECTED_SESSION_VERSION: String(version),
    RECEIPT_MODULE_ENABLED: 'true',
  }, false);
  return { configured: true, protectedSessionVersion: version, receiptModuleEnabled: true };
}

function isProtectedAccessConfigured_() {
  const properties = PropertiesService.getScriptProperties();
  return !!(properties.getProperty(PROP_KEYS.PROTECTED_PASSWORD_SALT) && properties.getProperty(PROP_KEYS.PROTECTED_PASSWORD_HASH));
}

function openProtectedSession(password, deviceId) {
  const safeDeviceId = normalizeDeviceId_(deviceId);
  const cache = CacheService.getScriptCache();
  const attemptKey = protectedAttemptKey_(safeDeviceId);
  const globalAttemptKey = 'PROTECTED_ATTEMPT_GLOBAL';
  const now = Date.now();
  const attempts = JSON.parse(cache.get(attemptKey) || '{"failures":0,"blockedUntil":0}');
  const globalAttempts = JSON.parse(cache.get(globalAttemptKey) || '{"failures":0,"blockedUntil":0}');
  const blockedUntil = Math.max(Number(attempts.blockedUntil) || 0, Number(globalAttempts.blockedUntil) || 0);
  if (blockedUntil > now) {
    const waitSeconds = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    logSecurityEvent_('PROTECTED_LOGIN', safeDeviceId, false, 'rate_limited');
    throw apiError_('PROTECTED_RATE_LIMIT', 'ลองรหัสหลายครั้งเกินไป กรุณารอ ' + waitSeconds + ' วินาที');
  }
  if (!isProtectedAccessConfigured_()) throw apiError_('PROTECTED_NOT_CONFIGURED', 'ส่วนงานภายในยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ');

  const properties = PropertiesService.getScriptProperties();
  const rounds = Number(properties.getProperty(PROP_KEYS.PROTECTED_PASSWORD_HASH_ROUNDS) || APP_CONFIG.PROTECTED_HASH_ROUNDS);
  const actual = deriveProtectedPasswordHash_(String(password == null ? '' : password), properties.getProperty(PROP_KEYS.PROTECTED_PASSWORD_SALT), rounds);
  const expected = properties.getProperty(PROP_KEYS.PROTECTED_PASSWORD_HASH);
  if (!constantTimeEquals_(actual, expected)) {
    const failures = Number(attempts.failures || 0) + 1;
    const globalFailures = Number(globalAttempts.failures || 0) + 1;
    const deviceBlockedUntil = failures >= APP_CONFIG.PROTECTED_MAX_ATTEMPTS ? now + APP_CONFIG.PROTECTED_LOCKOUT_SECONDS * 1000 : 0;
    const globalBlockedUntil = globalFailures >= APP_CONFIG.PROTECTED_GLOBAL_MAX_ATTEMPTS ? now + APP_CONFIG.PROTECTED_LOCKOUT_SECONDS * 1000 : 0;
    cache.put(attemptKey, JSON.stringify({ failures: failures, blockedUntil: deviceBlockedUntil }), APP_CONFIG.PROTECTED_ATTEMPT_WINDOW_SECONDS);
    cache.put(globalAttemptKey, JSON.stringify({ failures: globalFailures, blockedUntil: globalBlockedUntil }), APP_CONFIG.PROTECTED_ATTEMPT_WINDOW_SECONDS);
    const rateLimited = !!(deviceBlockedUntil || globalBlockedUntil);
    logSecurityEvent_('PROTECTED_LOGIN', safeDeviceId, false, rateLimited ? 'locked' : 'invalid');
    throw apiError_(rateLimited ? 'PROTECTED_RATE_LIMIT' : 'PROTECTED_PASSWORD_INVALID', rateLimited ? 'ลองรหัสหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' : 'รหัสผ่านไม่ถูกต้อง');
  }

  cache.remove(attemptKey);
  cache.remove(globalAttemptKey);
  const token = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + ':' + now + ':' + Math.random()
  )).replace(/=+$/, '');
  const session = {
    deviceId: safeDeviceId,
    issuedAt: now,
    expiresAt: now + APP_CONFIG.PROTECTED_SESSION_SECONDS * 1000,
    version: Number(properties.getProperty(PROP_KEYS.PROTECTED_SESSION_VERSION) || 1),
  };
  cache.put(protectedSessionKey_(token), JSON.stringify(session), APP_CONFIG.PROTECTED_SESSION_SECONDS);
  logSecurityEvent_('PROTECTED_LOGIN', safeDeviceId, true, 'session_issued');
  return { token: token, expiresAt: session.expiresAt };
}

function requireProtectedSession_(token, deviceId) {
  const safeToken = cleanString_(token, 200);
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(safeToken)) throw apiError_('PROTECTED_AUTH_REQUIRED', 'กรุณาใส่รหัสผ่านเพื่อเข้าสู่ส่วนงานภายใน');
  const raw = CacheService.getScriptCache().get(protectedSessionKey_(safeToken));
  if (!raw) throw apiError_('PROTECTED_AUTH_EXPIRED', 'สิทธิ์ส่วนงานภายในหมดอายุ กรุณาใส่รหัสผ่านอีกครั้ง');
  const session = JSON.parse(raw);
  const currentVersion = Number(getScriptProperty_(PROP_KEYS.PROTECTED_SESSION_VERSION, false) || 1);
  if (Number(session.expiresAt) <= Date.now() || Number(session.version) !== currentVersion || session.deviceId !== normalizeDeviceId_(deviceId)) {
    throw apiError_('PROTECTED_AUTH_EXPIRED', 'สิทธิ์ส่วนงานภายในหมดอายุ กรุณาใส่รหัสผ่านอีกครั้ง');
  }
  return session;
}

function deriveProtectedPasswordHash_(password, salt, rounds) {
  let value = sha256Hex_(cleanString_(salt, 200) + ':' + String(password == null ? '' : password));
  const safeRounds = Math.max(1, Math.min(10000, Number(rounds) || APP_CONFIG.PROTECTED_HASH_ROUNDS));
  for (let round = 0; round < safeRounds; round += 1) value = sha256Hex_(cleanString_(salt, 200) + ':' + value);
  return value;
}

function protectedSessionKey_(token) {
  return 'PROTECTED_SESSION_' + sha256Hex_(token).slice(0, 40);
}

function protectedAttemptKey_(deviceId) {
  return 'PROTECTED_ATTEMPT_' + sha256Hex_(normalizeDeviceId_(deviceId)).slice(0, 36);
}

function isProtectedAction_(action) {
  return [
    'verifyDatabaseAccess',
    'getReceiptWorkspace', 'saveReceiptTemplate', 'saveLaborGroup', 'createReceiptBatch', 'saveReceiptCardDraft',
    'saveReceiptRegistrations', 'listReceiptRegistrations', 'previewReceiptExport', 'exportReceiptDocuments', 'exportReceiptRosterExcel',
  ].indexOf(action) >= 0;
}
