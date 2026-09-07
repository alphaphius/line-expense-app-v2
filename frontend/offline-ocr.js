(function () {
  'use strict';

  const slots = [];
  const waiters = [];
  const initializationListeners = new Set();
  let initialization = null;

  function assetUrl(path) {
    return new URL(path, document.baseURI).href.replace(/\/$/, '');
  }

  function workerCount() {
    const cores = Number(navigator.hardwareConcurrency) || 2;
    const desktop = window.matchMedia('(min-width: 768px)').matches;
    return desktop && cores >= 6 ? 2 : 1;
  }

  function emitInitialization(message) {
    initializationListeners.forEach(listener => listener(message));
  }

  function translateProgress(message) {
    const labels = {
      'loading tesseract core': 'กำลังโหลดระบบ OCR',
      'initializing tesseract': 'กำลังเตรียมระบบ OCR',
      'loading language traineddata': 'กำลังโหลดภาษาไทย',
      'initializing api': 'กำลังเปิด OCR ภาษาไทย',
      'recognizing text': 'กำลังอ่านข้อความบนบัตร',
    };
    return {
      status: labels[message.status] || 'กำลังประมวลผล OCR',
      progress: Math.max(0, Math.min(1, Number(message.progress) || 0)),
    };
  }

  async function createSlot(index) {
    const slot = { worker: null, busy: false, progressHandler: null };
    const worker = await window.Tesseract.createWorker('tha', window.Tesseract.OEM.LSTM_ONLY, {
      workerPath: assetUrl('./vendor/tesseract/worker.min.js'),
      langPath: assetUrl('./vendor/tesseract/lang'),
      corePath: assetUrl('./vendor/tesseract/core'),
      cacheMethod: 'write',
      logger(message) {
        const progress = translateProgress(message || {});
        if (slot.progressHandler) slot.progressHandler(progress);
        else emitInitialization(Object.assign({ worker: index + 1 }, progress));
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: window.Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });
    slot.worker = worker;
    return slot;
  }

  async function initialize(onProgress) {
    if (typeof onProgress === 'function') initializationListeners.add(onProgress);
    try {
      if (!window.Tesseract) throw new Error('ไม่พบระบบ OCR กรุณารีโหลดหน้าเว็บแล้วลองใหม่');
      if (!initialization) {
        initialization = Promise.all(Array.from({ length: workerCount() }, (_, index) => createSlot(index)))
          .then(created => {
            slots.push(...created);
            emitInitialization({ status: 'OCR ภาษาไทยพร้อมใช้งาน', progress: 1 });
            return { workers: slots.length };
          })
          .catch(error => {
            initialization = null;
            throw new Error('โหลด OCR ภาษาไทยไม่สำเร็จ: ' + (error && error.message || error));
          });
      }
      return await initialization;
    } finally {
      if (typeof onProgress === 'function') initializationListeners.delete(onProgress);
    }
  }

  function acquireSlot() {
    const available = slots.find(slot => !slot.busy);
    if (available) {
      available.busy = true;
      return Promise.resolve(available);
    }
    return new Promise(resolve => waiters.push(resolve));
  }

  function releaseSlot(slot) {
    slot.progressHandler = null;
    const next = waiters.shift();
    if (next) next(slot);
    else slot.busy = false;
  }

  function thaiDigitsToAscii(value) {
    return String(value || '').replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
  }

  function normalizeLine(value) {
    return thaiDigitsToAscii(value).replace(/[|_[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeNationalId(value) {
    return thaiDigitsToAscii(value).replace(/\D/g, '').slice(0, 13);
  }

  function validateNationalId(value) {
    const id = normalizeNationalId(value);
    if (!/^\d{13}$/.test(id) || /^(\d)\1{12}$/.test(id)) return false;
    let sum = 0;
    for (let index = 0; index < 12; index += 1) sum += Number(id[index]) * (13 - index);
    return (11 - (sum % 11)) % 10 === Number(id[12]);
  }

  function extractNationalId(text) {
    const candidates = thaiDigitsToAscii(text).match(/(?:\d[\s.\-]*){13}/g) || [];
    const ids = candidates.map(normalizeNationalId).filter(id => id.length === 13);
    return ids.find(validateNationalId) || ids[0] || '';
  }

  function cleanName(value) {
    return normalizeLine(value)
      .replace(/^(?:ชื่อและนามสกุล|ชื่อตัวและชื่อสกุล|ชื่อสกุล|ชื่อ|Name)\s*[:：-]?\s*/i, '')
      .replace(/^(?:นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง)\s*/, '')
      .replace(/\b(?:Miss|Mrs?\.?|Mr\.?)\b/gi, '')
      .replace(/\s+/g, ' ').trim();
  }

  function extractName(lines) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!/(ชื่อ(?:และนามสกุล|ตัวและชื่อสกุล|สกุล)?|\bName\b)/i.test(lines[index])) continue;
      let candidate = cleanName(lines[index]);
      if (!/[ก-๙]/.test(candidate) && lines[index + 1]) candidate = cleanName(lines[index + 1]);
      if (/[ก-๙]{2}/.test(candidate)) return candidate;
    }
    const titled = lines.map(cleanName).find(line => /^(?:นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง)?\s*[ก-๙]{2,}\s+[ก-๙]{2,}/.test(line));
    return titled || '';
  }

  function extractAddress(lines) {
    const stop = /(วันเกิด|Date of Birth|วันออกบัตร|วันบัตรหมดอายุ|Issue|Expiry|ศาสนา|Religion|เจ้าพนักงาน)/i;
    for (let index = 0; index < lines.length; index += 1) {
      if (!/(ที่อยู่|Address)/i.test(lines[index])) continue;
      const parts = [];
      const first = lines[index].replace(/^.*?(?:ที่อยู่|Address)\s*[:：-]?\s*/i, '').trim();
      if (first) parts.push(first);
      for (let cursor = index + 1; cursor < Math.min(lines.length, index + 5); cursor += 1) {
        if (stop.test(lines[cursor])) break;
        if (lines[cursor]) parts.push(lines[cursor]);
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function parseThaiIdText(text, confidence) {
    const lines = String(text || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
    const fullName = extractName(lines);
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const nationalId = extractNationalId(text);
    const address = extractAddress(lines);
    const warnings = [];
    if (!fullName) warnings.push('อ่านชื่อไม่ครบ กรุณากรอกหรือแก้ไข');
    if (!nationalId) warnings.push('ไม่พบเลขบัตร 13 หลัก กรุณากรอกเอง');
    else if (!validateNationalId(nationalId)) warnings.push('เลขบัตรไม่ผ่าน checksum กรุณาตรวจสอบ');
    if (!address) warnings.push('อ่านที่อยู่ไม่ครบ กรุณากรอกหรือแก้ไข');
    if (Number(confidence) < 70) warnings.push('ภาพหรือข้อความไม่ชัด กรุณาตรวจสอบข้อมูลทุกช่อง');
    return {
      full_name: fullName,
      first_name: nameParts.shift() || '',
      last_name: nameParts.join(' '),
      national_id: nationalId,
      address,
      confidence: Math.max(0, Math.min(100, Math.round(Number(confidence) || 0))),
      warnings,
    };
  }

  async function recognize(image, onProgress) {
    await initialize();
    const slot = await acquireSlot();
    slot.progressHandler = typeof onProgress === 'function' ? onProgress : null;
    try {
      const result = await slot.worker.recognize(image);
      return parseThaiIdText(result.data.text, result.data.confidence);
    } finally {
      releaseSlot(slot);
    }
  }

  window.OfflineThaiIdOcr = Object.freeze({ initialize, recognize, parseThaiIdText, validateNationalId });
})();
