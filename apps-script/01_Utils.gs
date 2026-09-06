function nowIso_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function todayIso_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function uuid_() {
  return Utilities.getUuid();
}

function cleanString_(value, maxLength) {
  const text = value == null ? '' : String(value).trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function normalizeThaiText_(value) {
  return cleanString_(value).toLowerCase()
    .replace(/บริษัท|จำกัด|มหาชน|สำนักงานใหญ่/g, '')
    .replace(/[\s.,()\-_/]/g, '');
}

function normalizeTaxId_(value) {
  const digits = cleanString_(value).replace(/\D/g, '').slice(0, 13);
  // Google Sheets รูปแบบ General อาจตัด 0 ตัวแรกของ Tax ID ไทย 13 หลัก
  return digits.length === 12 ? '0' + digits : digits;
}

function isValidTaxId_(value, allowEmpty) {
  const taxId = normalizeTaxId_(value);
  return allowEmpty && !taxId ? true : /^\d{13}$/.test(taxId);
}

function normalizeAddress_(value) {
  return cleanString_(value).toLowerCase()
    .replace(/กรุงเทพมหานคร|กรุงเทพฯ|กทม\.?/g, 'กรุงเทพ')
    .replace(/ถนน|ถ\.|แขวง|เขต|ตำบล|ต\.|อำเภอ|อ\.|จังหวัด|จ\.|รหัสไปรษณีย์/g, '')
    .replace(/[^0-9a-zก-๙]/g, '');
}

function isAddressMatch_(actual, expected) {
  const left = normalizeAddress_(actual);
  const right = normalizeAddress_(expected);
  if (!left || !right) return false;
  if (left.indexOf(right) >= 0 || right.indexOf(left) >= 0) return true;
  const importantParts = ['151', 'นวลจันทร์', 'บึงกุ่ม', '10230'];
  const expectedParts = importantParts.filter(function (part) { return right.indexOf(part) >= 0; });
  if (!expectedParts.length) return false;
  const matched = expectedParts.filter(function (part) { return left.indexOf(part) >= 0; }).length;
  return matched / expectedParts.length >= 0.75;
}

function formatThaiDateLong_(isoDate) {
  const value = toIsoDate_(isoDate);
  if (!value) return '-';
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return days[date.getUTCDay()] + ' ที่ ' + parts[2] + ' ' + months[parts[1] - 1] + ' ' + (parts[0] + 543);
}

function serializeCellValue_(value, header) {
  if (!(value instanceof Date)) return value;
  if (/_date$/.test(header)) return Utilities.formatDate(value, APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  return Utilities.formatDate(value, APP_CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function toBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true' || value === 1;
}

function toNumber_(value) {
  const number = Number(String(value == null ? '' : value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function toIsoDate_(value) {
  const text = cleanString_(value);
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year > 2400) year -= 543;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return '';
  return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

function billDateNormalRange_(referenceIso) {
  const maximum = toIsoDate_(referenceIso) || todayIso_();
  const parts = maximum.split('-').map(Number);
  const minimumDate = new Date(Date.UTC(parts[0], parts[1] - 3, 1));
  return {
    minimum: [
      minimumDate.getUTCFullYear(),
      String(minimumDate.getUTCMonth() + 1).padStart(2, '0'),
      '01',
    ].join('-'),
    maximum: maximum,
  };
}

function billDateReviewWarning_(value, referenceIso) {
  const documentDate = toIsoDate_(value);
  if (!documentDate) {
    return 'ไม่พบวันที่ในบิล วัน เดือน หรือปีอาจอ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  }
  const range = billDateNormalRange_(referenceIso);
  if (documentDate > range.maximum) {
    return 'วันที่ในบิลเป็นวันอนาคต วัน เดือน หรือปีอาจไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  }
  if (documentDate < range.minimum) {
    return 'วันที่ในบิลย้อนหลังเกิน 2 เดือน วัน เดือน หรือปีอาจไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  }
  return '';
}

function missingBillDateFallbackReason_(fallbackDate) {
  return 'ไม่พบวันที่ในบิล ใช้วันที่ส่งบิลเข้าระบบ ' + (toIsoDate_(fallbackDate) || todayIso_()) + ' เป็นค่าเริ่มต้น กรุณาตรวจสอบก่อนยืนยัน';
}

function isMissingBillDateFallbackReason_(reason) {
  return cleanString_(reason).indexOf('ไม่พบวันที่ในบิล ใช้วันที่ส่งบิลเข้าระบบ') >= 0;
}

function refreshBillDateReviewReasons_(existingReasons, warning, options) {
  options = options || {};
  const dateReasonMarkers = [
    'ไม่พบวันที่ในบิล วัน เดือน หรือปี',
    'ไม่พบวันที่ในบิล ใช้วันที่ส่งบิลเข้าระบบ',
    'วันที่ในบิลเป็นวันอนาคต วัน เดือน หรือปี',
    'วันที่ในบิลย้อนหลังเกิน 2 เดือน วัน เดือน หรือปี',
  ];
  const reasons = (Array.isArray(existingReasons) ? existingReasons : cleanString_(existingReasons).split('|'))
    .map(function (reason) { return cleanString_(reason, 150); })
    .filter(function (reason) {
      if (options.preserveMissingFallback && isMissingBillDateFallbackReason_(reason)) return true;
      return reason && !dateReasonMarkers.some(function (marker) { return reason.indexOf(marker) >= 0; });
    });
  if (warning && reasons.indexOf(warning) < 0) reasons.push(warning);
  return reasons;
}

function safeJson_(value) {
  try { return JSON.stringify(value == null ? null : value); } catch (error) { return ''; }
}

function requireFields_(payload, fields) {
  fields.forEach(function (field) {
    if (!cleanString_(payload[field])) throw new Error('กรุณาระบุ ' + field);
  });
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(APP_CONFIG.LOCK_WAIT_MS);
  try { return callback(); } finally { lock.releaseLock(); }
}

function sanitizeFolderName_(value) {
  return cleanString_(value || 'ไม่ระบุโครงการ', 100).replace(/[\\/:*?"<>|#%]/g, '-');
}

function getScriptProperty_(key, required) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !value) throw new Error('ยังไม่ได้ตั้งค่า Script Property: ' + key);
  return value || '';
}

function ok_(data) {
  return { ok: true, data: data == null ? null : data };
}

function fail_(error) {
  console.error(error && error.stack ? error.stack : error);
  return { ok: false, error: error && error.message ? error.message : String(error) };
}
