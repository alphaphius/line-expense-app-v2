import crypto from 'node:crypto';

export const nowSql = () => new Date().toISOString().slice(0, 23).replace('T', ' ');
export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const clean = (value, max = 1000) => String(value == null ? '' : value).trim().slice(0, max);
export const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const bool = value => value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
export const jsonArray = value => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
};
export const normalizeId = value => clean(value, 64).replace(/[^A-Za-z0-9_-]/g, '');
export const normalizeNationalId = value => clean(value, 30).replace(/\D/g, '').slice(0, 13);
export const normalizeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(clean(value, 10)) ? clean(value, 10) : null;
export const normalizePeriod = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(clean(value, 7)) ? clean(value, 7) : new Date().toISOString().slice(0, 7);
export const maskNationalId = value => {
  const id = normalizeNationalId(value);
  return id.length === 13 ? `${id.slice(0, 1)}-${id.slice(1, 5)}-*****-${id.slice(-2)}` : '';
};
export const apiError = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
export const envelope = (ok, data, error, requestId, apiVersion = '2.0') => ({
  ok, data: data ?? null, error: error || null, requestId: requestId || uuid(), serverTime: nowIso(), apiVersion,
});

export function publicRow(row) {
  if (!row) return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) result[key] = value.toISOString();
    else if (Buffer.isBuffer(value)) result[key] = value.toString('utf8');
    else if (['review_reasons', 'ocr_warnings', 'placeholders', 'group_ids', 'registration_ids'].includes(key)) result[key] = jsonArray(value);
    else if (typeof value === 'bigint') result[key] = Number(value);
    else result[key] = value;
  }
  return result;
}

