import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.mjs';
import { execute, one, select } from './db.mjs';
import { apiError, clean, nowSql, sha256, token } from './utils.mjs';

const scrypt = promisify(crypto.scrypt);

function expiry(seconds) {
  return new Date(Date.now() + seconds * 1000);
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const workFactor = 16384;
  const blockSize = 8;
  const parallelization = 1;
  const derived = await scrypt(String(password), salt, 32, { N: workFactor, r: blockSize, p: parallelization, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${workFactor}$${blockSize}$${parallelization}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded = config.passwordHash) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltValue, hashValue] = parts;
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = Buffer.from(await scrypt(String(password), Buffer.from(saltValue, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  }));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function openApiSession(deviceId) {
  const device = clean(deviceId, 160).replace(/[^A-Za-z0-9_-]/g, '');
  if (device.length < 12) throw apiError('INVALID_DEVICE', 'รหัสอุปกรณ์ไม่ถูกต้อง');
  const raw = token(32);
  const expires = expiry(config.sessionSeconds);
  await execute('DELETE FROM api_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
  await execute('INSERT INTO api_sessions (token_hash, device_id, expires_at, created_at) VALUES (:hash, :device, :expires, :created)', {
    hash: sha256(raw), device, expires, created: nowSql(),
  });
  return { token: raw, expiresAt: expires.getTime(), sessionSeconds: config.sessionSeconds };
}

export async function requireApiSession(rawToken) {
  const value = clean(rawToken, 200);
  if (!value) throw apiError('AUTH_REQUIRED', 'กรุณาเชื่อมต่อระบบใหม่', 401);
  const row = await one('SELECT device_id, expires_at FROM api_sessions WHERE token_hash = :hash', { hash: sha256(value) });
  if (!row) throw apiError('AUTH_REQUIRED', 'ไม่พบเซสชัน กรุณาเชื่อมต่อใหม่', 401);
  if (new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() <= Date.now()) {
    await execute('DELETE FROM api_sessions WHERE token_hash = :hash', { hash: sha256(value) });
    throw apiError('AUTH_EXPIRED', 'เซสชันหมดอายุ กรุณาเชื่อมต่อใหม่', 401);
  }
  return { deviceId: row.device_id };
}

async function checkLockout(deviceId) {
  const windowStart = new Date(Date.now() - config.attemptWindowSeconds * 1000);
  const rows = await select('SELECT device_id, success FROM login_attempts WHERE created_at >= :windowStart ORDER BY created_at DESC', { windowStart });
  const globalFailures = rows.filter(row => !row.success).length;
  const deviceFailures = rows.filter(row => row.device_id === deviceId && !row.success).length;
  if (globalFailures >= config.globalMaxAttempts || deviceFailures >= config.maxAttempts) {
    throw apiError('PROTECTED_LOCKED', `มีการลองรหัสผิดหลายครั้ง กรุณารอ ${Math.ceil(config.lockoutSeconds / 60)} นาที`, 429);
  }
}

export async function openProtectedSession(password, deviceId) {
  if (!config.passwordHash) throw apiError('PROTECTED_NOT_CONFIGURED', 'ผู้ดูแลยังไม่ได้ตั้งรหัสผ่าน WorkHub', 503);
  await checkLockout(deviceId);
  const valid = await verifyPassword(password);
  await execute('INSERT INTO login_attempts (device_id, success, detail, created_at) VALUES (:device, :success, :detail, :created)', {
    device: deviceId, success: valid ? 1 : 0, detail: valid ? 'LOGIN_OK' : 'INVALID_PASSWORD', created: nowSql(),
  });
  if (!valid) throw apiError('PROTECTED_INVALID_PASSWORD', 'รหัสผ่านไม่ถูกต้อง', 401);
  const raw = token(32);
  const expires = expiry(config.protectedSessionSeconds);
  await execute('DELETE FROM protected_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
  await execute('INSERT INTO protected_sessions (token_hash, device_id, expires_at, created_at) VALUES (:hash, :device, :expires, :created)', {
    hash: sha256(raw), device: deviceId, expires, created: nowSql(),
  });
  return { token: raw, expiresAt: expires.getTime(), sessionSeconds: config.protectedSessionSeconds };
}

export async function requireProtectedSession(rawToken, deviceId) {
  const value = clean(rawToken, 200);
  if (!value) throw apiError('PROTECTED_AUTH_REQUIRED', 'กรุณาใส่รหัสผ่านเพื่อเข้าใช้งานส่วนนี้', 401);
  const row = await one('SELECT device_id, expires_at FROM protected_sessions WHERE token_hash = :hash', { hash: sha256(value) });
  if (!row || row.device_id !== deviceId) throw apiError('PROTECTED_AUTH_REQUIRED', 'กรุณาใส่รหัสผ่านเพื่อเข้าใช้งานส่วนนี้', 401);
  if (new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() <= Date.now()) {
    await execute('DELETE FROM protected_sessions WHERE token_hash = :hash', { hash: sha256(value) });
    throw apiError('PROTECTED_AUTH_EXPIRED', 'สิทธิ์เข้าใช้งานหมดอายุ กรุณาใส่รหัสผ่านอีกครั้ง', 401);
  }
  return true;
}

