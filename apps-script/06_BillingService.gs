function submitBillPages(payload) {
  try {
    setupIfNeeded_();
    payload = payload || {};
    requireFields_(payload, ['project_id', 'company_id']);
    const files = Array.isArray(payload.files) ? payload.files : [];
    const expectedPages = Math.max(1, Math.min(APP_CONFIG.MAX_PAGES_PER_BILL, Number(payload.expected_pages) || files.length || 1));
    if (!files.length) throw new Error('กรุณาเลือกรูปบิลอย่างน้อย 1 รูป');
    if (files.length !== expectedPages) throw new Error('จำนวนรูปที่เลือกไม่ตรงกับจำนวนหน้าของบิล');
    if (files.length > APP_CONFIG.MAX_PAGES_PER_BILL) throw new Error('รองรับไม่เกิน ' + APP_CONFIG.MAX_PAGES_PER_BILL + ' หน้าต่อบิล');
    const totalBytes = files.reduce(function (sum, filePayload) {
      const match = cleanString_(filePayload && filePayload.dataUrl).match(/^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/);
      return sum + (match ? Math.floor(match[1].replace(/\s/g, '').length * 0.75) : 0);
    }, 0);
    if (totalBytes > APP_CONFIG.MAX_UPLOAD_TOTAL_MB * 1024 * 1024) {
      throw new Error('ไฟล์รวมต้องมีขนาดไม่เกิน ' + APP_CONFIG.MAX_UPLOAD_TOTAL_MB + ' MB หลังบีบอัด');
    }

    const project = findById_(SHEETS.PROJECTS, 'project_id', payload.project_id);
    const targetCompany = findById_(SHEETS.COMPANIES, 'company_id', payload.company_id);
    if (!project || !toBoolean_(project.active)) throw new Error('ไม่พบโครงการ');
    if (!targetCompany || !toBoolean_(targetCompany.active)) throw new Error('ไม่พบบริษัท');

    const sessionId = uuid_();
    const billId = uuid_();
    const timestamp = nowIso_();
    appendObject_(SHEETS.SESSIONS, {
      session_id: sessionId, project_id: project.project_id, company_id: targetCompany.company_id,
      expected_pages: expectedPages, received_pages: files.length, status: 'PROCESSING',
      source: cleanString_(payload.source || 'WEB'), source_user_id: cleanString_(payload.source_user_id),
      created_at: timestamp, expires_at: Utilities.formatDate(new Date(Date.now() + APP_CONFIG.SESSION_HOURS * 3600000), APP_CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"), updated_at: timestamp,
    });

    const folder = getImageFolder_(project.project_name, todayIso_());
    const savedFiles = [];
    try {
      files.forEach(function (filePayload, index) {
        const saved = saveUploadedFile_(filePayload, folder, sessionId, index + 1);
        saved.record.bill_id = billId;
        savedFiles.push(saved);
      });
      appendObjects_(SHEETS.DOCUMENTS, savedFiles.map(function (saved) { return saved.record; }));

      const companies = publicRows_(SHEETS.COMPANIES).filter(function (row) { return toBoolean_(row.active); });
      const categories = publicRows_(SHEETS.CATEGORIES).filter(function (row) { return toBoolean_(row.active); });
      const ai = analyzeBillBlobs_(savedFiles.map(function (entry) { return entry.blob; }), {
        companies: companies, categories: categories, billId: billId, receivedDate: timestamp.slice(0, 10),
      });
      const vendor = upsertVendor_(ai);
      const selectedCompanyTax = normalizeTaxId_(targetCompany.tax_id);
      const duplicateKey = [normalizeTaxId_(ai.vendor_tax_id) || normalizeThaiText_(ai.vendor_name), cleanString_(ai.document_no), ai.document_date, toNumber_(ai.grand_total).toFixed(2)].join('|');
      const duplicate = getRows_(SHEETS.BILLS).find(function (row) { return row.duplicate_key === duplicateKey && row.status !== 'REJECTED'; });
      if (duplicate) {
        ai.needs_review = true;
        ai.review_reasons.push('อาจเป็นบิลซ้ำกับเลขที่ ' + duplicate.bill_id);
      }
      const buyerTax = normalizeTaxId_(ai.buyer_tax_id);
      const taxMatch = !!selectedCompanyTax && selectedCompanyTax === buyerTax;
      const companyNameMatch = String(ai.company_id) === String(targetCompany.company_id) || normalizeThaiText_(ai.buyer_name) === normalizeThaiText_(targetCompany.company_name);
      const addressMatch = isAddressMatch_(ai.buyer_address, targetCompany.address);
      if (!taxMatch) {
        ai.needs_review = true;
        ai.review_reasons.push('เลขผู้เสียภาษีผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
      }
      if (!addressMatch) {
        ai.needs_review = true;
        ai.review_reasons.push('ที่อยู่ผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
      }

      const bill = {
        bill_id: billId, session_id: sessionId, project_id: project.project_id, company_id: targetCompany.company_id,
        category_id: ai.category_id, doc_type: ai.doc_type, document_no: cleanString_(ai.document_no, 100),
        document_date: ai.document_date, due_date: ai.due_date, vendor_id: vendor.vendor_id,
        vendor_name: cleanString_(ai.vendor_name, 200), vendor_tax_id: normalizeTaxId_(ai.vendor_tax_id),
        vendor_branch: cleanString_(ai.vendor_branch, 100), vendor_address: cleanString_(ai.vendor_address, 500),
        buyer_name: cleanString_(ai.buyer_name, 200), buyer_tax_id: buyerTax, buyer_address: cleanString_(ai.buyer_address, 500),
        currency: cleanString_(ai.currency || 'THB', 10), subtotal: toNumber_(ai.subtotal), discount: toNumber_(ai.discount),
        vat_rate: toNumber_(ai.vat_rate), vat_amount: toNumber_(ai.vat_amount), withholding_tax: toNumber_(ai.withholding_tax),
        grand_total: toNumber_(ai.grand_total), payment_method: cleanString_(ai.payment_method, 100),
        description: cleanString_(ai.description, 500), notes: cleanString_(ai.notes, 1000), page_count: expectedPages,
        image_quality: ai.image_quality, quality_score: ai.quality_score, needs_review: ai.needs_review,
        review_reasons: ai.review_reasons.join(' | '), company_match: companyNameMatch,
        tax_id_match: taxMatch, duplicate_key: duplicateKey,
        status: ai.needs_review ? 'NEEDS_REVIEW' : 'PENDING_CONFIRMATION', source: cleanString_(payload.source || 'WEB'),
        source_user_id: cleanString_(payload.source_user_id), folder_path: folderPathFor_(project.project_name, todayIso_()),
        created_at: timestamp, updated_at: timestamp, confirmed_at: '', address_match: addressMatch,
      };
      appendObject_(SHEETS.BILLS, bill);
      appendObjects_(SHEETS.ITEMS, (ai.items || []).map(function (item, index) {
        return {
          item_id: uuid_(), bill_id: billId, line_no: index + 1, description: cleanString_(item.description, 300),
          quantity: toNumber_(item.quantity), unit: cleanString_(item.unit, 50), unit_price: toNumber_(item.unit_price),
          discount: toNumber_(item.discount), vat_amount: toNumber_(item.vat_amount), amount: toNumber_(item.amount), sku: cleanString_(item.sku, 100),
        };
      }));
      updateObjectById_(SHEETS.SESSIONS, 'session_id', sessionId, { status: 'READY', updated_at: nowIso_() });
      appendAudit_('bill', billId, 'AI_EXTRACT', null, bill, cleanString_(payload.source_user_id || 'WEB'));
      return ok_(getBillDetail_(billId));
    } catch (error) {
      updateObjectById_(SHEETS.SESSIONS, 'session_id', sessionId, { status: 'ERROR', updated_at: nowIso_() });
      throw error;
    }
  } catch (error) { return fail_(error); }
}

function updateBill(payload) {
  try {
    payload = payload || {};
    requireFields_(payload, ['bill_id', 'project_id', 'company_id']);
    return ok_(withScriptLock_(function () {
      const before = findById_(SHEETS.BILLS, 'bill_id', payload.bill_id);
      if (!before) throw new Error('ไม่พบบิล');
      if (before.status === 'REJECTED') throw new Error('บิลนี้ถูกลบออกจากรายการแล้ว กรุณากู้คืนก่อนแก้ไข');
      const allowed = ['project_id', 'company_id', 'category_id', 'doc_type', 'document_no', 'document_date', 'due_date',
        'vendor_name', 'vendor_tax_id', 'vendor_branch', 'vendor_address', 'buyer_name', 'buyer_tax_id', 'buyer_address',
        'currency', 'subtotal', 'discount', 'vat_rate', 'vat_amount', 'withholding_tax', 'grand_total', 'payment_method', 'description', 'notes'];
      const patch = {};
      allowed.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(payload, key)) patch[key] = payload[key]; });
      if (Object.prototype.hasOwnProperty.call(patch, 'document_date')) patch.document_date = toIsoDate_(patch.document_date);
      if (Object.prototype.hasOwnProperty.call(patch, 'due_date')) patch.due_date = toIsoDate_(patch.due_date);
      if (Object.prototype.hasOwnProperty.call(patch, 'vendor_tax_id')) patch.vendor_tax_id = normalizeTaxId_(patch.vendor_tax_id);
      if (Object.prototype.hasOwnProperty.call(patch, 'buyer_tax_id')) patch.buyer_tax_id = normalizeTaxId_(patch.buyer_tax_id);
      const effectiveBill = Object.assign({}, before, patch);
      if (!isValidTaxId_(effectiveBill.vendor_tax_id, true)) throw new Error('Tax ID ผู้ขายต้องมี 13 หลัก หรือเว้นว่าง');
      if (!isValidTaxId_(effectiveBill.buyer_tax_id, true)) throw new Error('Tax ID ผู้ซื้อต้องมี 13 หลัก หรือเว้นว่าง');
      ['subtotal', 'discount', 'vat_rate', 'vat_amount', 'withholding_tax', 'grand_total'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) patch[key] = toNumber_(patch[key]);
      });
      const company = findById_(SHEETS.COMPANIES, 'company_id', effectiveBill.company_id);
      patch.tax_id_match = !!company && normalizeTaxId_(company.tax_id) === normalizeTaxId_(effectiveBill.buyer_tax_id);
      patch.company_match = !!company && normalizeThaiText_(company.company_name) === normalizeThaiText_(effectiveBill.buyer_name);
      patch.address_match = !!company && isAddressMatch_(effectiveBill.buyer_address, company.address);
      const dateWarning = billDateReviewWarning_(effectiveBill.document_date);
      const documentDateWasEdited = Object.prototype.hasOwnProperty.call(patch, 'document_date');
      const preserveMissingFallback = isMissingBillDateFallbackReason_(before.review_reasons) && !documentDateWasEdited;
      patch.review_reasons = refreshBillDateReviewReasons_(before.review_reasons, dateWarning, { preserveMissingFallback: preserveMissingFallback }).join(' | ');
      patch.needs_review = !patch.tax_id_match || !patch.address_match || !effectiveBill.document_date || !cleanString_(effectiveBill.vendor_name) || !!dateWarning || preserveMissingFallback;
      patch.status = patch.needs_review ? 'NEEDS_REVIEW' : 'PENDING_CONFIRMATION';
      patch.updated_at = nowIso_();
      const updated = updateObjectById_(SHEETS.BILLS, 'bill_id', payload.bill_id, patch);
      appendAudit_('bill', payload.bill_id, 'UPDATE', before, updated, cleanString_(payload.actor || 'WEB'));
      return getBillDetail_(payload.bill_id);
    }));
  } catch (error) { return fail_(error); }
}

function confirmBill(billId, actor) {
  try {
    const confirmation = withScriptLock_(function () {
      const before = findById_(SHEETS.BILLS, 'bill_id', billId);
      if (!before) throw new Error('ไม่พบบิล');
      if (before.status === 'REJECTED') throw new Error('บิลนี้ถูกลบออกจากรายการแล้ว');
      if (before.status === 'CONFIRMED') {
        return { bill: getBillDetail_(billId), newly_confirmed: false };
      }
      const updated = updateObjectById_(SHEETS.BILLS, 'bill_id', billId, {
        status: 'CONFIRMED', needs_review: false, updated_at: nowIso_(), confirmed_at: nowIso_(),
      });
      appendAudit_('bill', billId, 'CONFIRM', before, updated, cleanString_(actor || 'WEB'));
      return { bill: getBillDetail_(billId), newly_confirmed: true };
    });

    if (shouldPushSavedFlexAfterConfirm_(actor, confirmation.bill, confirmation.newly_confirmed)) {
      try {
        pushBillSavedFlexToOriginalLineUser_(confirmation.bill);
      } catch (notificationError) {
        console.error('ยืนยันบิลสำเร็จ แต่ส่ง Flex กลับ LINE ไม่สำเร็จ: ' + cleanString_(notificationError.message || notificationError, 500));
      }
    }
    return ok_(confirmation.bill);
  } catch (error) { return fail_(error); }
}

function rejectBill(billId, actor) {
  try {
    return ok_(withScriptLock_(function () {
      const before = findById_(SHEETS.BILLS, 'bill_id', billId);
      if (!before) throw new Error('ไม่พบบิล');
      if (before.status === 'CONFIRMED') throw new Error('บิลนี้ยืนยันแล้ว จึงไม่สามารถยกเลิกด้วยคำสั่งนี้ได้');
      const updated = updateObjectById_(SHEETS.BILLS, 'bill_id', billId, {
        status: 'REJECTED', needs_review: false, updated_at: nowIso_(),
        notes: [cleanString_(before.notes), 'ยกเลิกโดย ' + cleanString_(actor || 'WEB')].filter(Boolean).join(' | '),
      });
      if (before.session_id) {
        const session = findById_(SHEETS.SESSIONS, 'session_id', before.session_id);
        if (session) updateObjectById_(SHEETS.SESSIONS, 'session_id', before.session_id, { status: 'CANCELLED', updated_at: nowIso_() });
      }
      appendAudit_('bill', billId, 'REJECT', before, updated, cleanString_(actor || 'WEB'));
      return updated;
    }));
  } catch (error) { return fail_(error); }
}

function deleteBill(billId, actor) {
  try {
    return ok_(withScriptLock_(function () {
      const before = findById_(SHEETS.BILLS, 'bill_id', billId);
      if (!before) throw new Error('ไม่พบบิล');
      if (before.status === 'REJECTED') return { bill_id: billId, status: 'REJECTED' };
      const timestamp = nowIso_();
      const updated = updateObjectById_(SHEETS.BILLS, 'bill_id', billId, deletedBillPatch_(before, actor, timestamp));
      if (before.session_id && before.status !== 'CONFIRMED') {
        const session = findById_(SHEETS.SESSIONS, 'session_id', before.session_id);
        if (session) updateObjectById_(SHEETS.SESSIONS, 'session_id', before.session_id, { status: 'CANCELLED', updated_at: timestamp });
      }
      appendAudit_('bill', billId, 'DELETE', before, updated, cleanString_(actor || 'WEB'));
      return updated;
    }));
  } catch (error) { return fail_(error); }
}

function restoreBill(billId, actor) {
  try {
    return ok_(withScriptLock_(function () {
      const before = findById_(SHEETS.BILLS, 'bill_id', billId);
      if (!before) throw new Error('ไม่พบบิล');
      if (before.status !== 'REJECTED') throw new Error('บิลนี้ยังไม่ได้ถูกลบ');
      const updated = updateObjectById_(SHEETS.BILLS, 'bill_id', billId, restoredBillPatch_(before, nowIso_()));
      appendAudit_('bill', billId, 'RESTORE', before, updated, cleanString_(actor || 'WEB'));
      return getBillDetail_(billId);
    }));
  } catch (error) { return fail_(error); }
}

function deletedBillPatch_(before, actor, timestamp) {
  return {
    status: 'REJECTED', needs_review: false, updated_at: timestamp,
    notes: [cleanString_(before && before.notes), 'ลบออกจากรายการโดย ' + cleanString_(actor || 'WEB')].filter(Boolean).join(' | '),
  };
}

function restoredBillPatch_(before, timestamp) {
  return {
    status: 'NEEDS_REVIEW', needs_review: true, confirmed_at: '', updated_at: timestamp,
    review_reasons: [cleanString_(before && before.review_reasons), 'กู้คืนจากรายการที่ลบ กรุณาตรวจสอบอีกครั้ง'].filter(Boolean).join(' | '),
  };
}

function getBillDetail(billId) {
  try { return ok_(getBillDetail_(billId)); } catch (error) { return fail_(error); }
}

function getBillDetail_(billId) {
  const bill = findById_(SHEETS.BILLS, 'bill_id', billId);
  if (!bill) throw new Error('ไม่พบบิล');
  const clean = publicRecord_(bill);
  clean.items = publicRows_(SHEETS.ITEMS).filter(function (item) { return item.bill_id === billId; });
  clean.documents = publicRows_(SHEETS.DOCUMENTS).filter(function (item) { return item.bill_id === billId; });
  const project = findById_(SHEETS.PROJECTS, 'project_id', bill.project_id) || {};
  const company = findById_(SHEETS.COMPANIES, 'company_id', bill.company_id) || {};
  const category = findById_(SHEETS.CATEGORIES, 'category_id', bill.category_id) || {};
  clean.project_name = project.project_name || '-';
  clean.company_name = company.company_name || '-';
  clean.category_name = category.category_name || 'ยังไม่จัดกลุ่ม';
  return clean;
}

function getBillDocumentPreview(docId) {
  try {
    const document = findById_(SHEETS.DOCUMENTS, 'doc_id', docId);
    if (!document) throw new Error('ไม่พบไฟล์เอกสาร');
    if (!document.file_id) return ok_({ fileName: document.file_name || 'เอกสาร', mimeType: '', dataUrl: '', externalUrl: document.file_url || '' });
    const file = DriveApp.getFileById(document.file_id);
    let blob = file.getBlob();
    if (/^image\//i.test(blob.getContentType()) && blob.getBytes().length > APP_CONFIG.EXPORT_IMAGE_TARGET_BYTES) {
      try { blob = file.getThumbnail() || blob; } catch (ignored) { console.error(ignored); }
    }
    const bytes = blob.getBytes();
    if (bytes.length > APP_CONFIG.MAX_FILE_MB * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินกว่าจะแสดงตัวอย่าง');
    return ok_({
      fileName: document.file_name || file.getName(), mimeType: blob.getContentType(),
      dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(bytes), externalUrl: document.file_url || file.getUrl(),
    });
  } catch (error) { return fail_(error); }
}

function upsertVendor_(ai) {
  const taxId = normalizeTaxId_(ai.vendor_tax_id);
  const normalizedName = normalizeThaiText_(ai.vendor_name);
  let vendor = getRows_(SHEETS.VENDORS).find(function (item) {
    return (taxId && normalizeTaxId_(item.tax_id) === taxId) || (!taxId && item.normalized_name === normalizedName);
  });
  const timestamp = nowIso_();
  if (vendor) {
    return updateObjectById_(SHEETS.VENDORS, 'vendor_id', vendor.vendor_id, {
      vendor_name: cleanString_(ai.vendor_name, 200), normalized_name: normalizedName, tax_id: taxId,
      branch_name: cleanString_(ai.vendor_branch, 100), address: cleanString_(ai.vendor_address, 500),
      use_count: toNumber_(vendor.use_count) + 1, last_used_at: timestamp, updated_at: timestamp,
    });
  }
  vendor = {
    vendor_id: uuid_(), vendor_name: cleanString_(ai.vendor_name || 'ไม่ทราบชื่อ', 200), normalized_name: normalizedName,
    tax_id: taxId, branch_name: cleanString_(ai.vendor_branch, 100), address: cleanString_(ai.vendor_address, 500),
    use_count: 1, last_used_at: timestamp, created_at: timestamp, updated_at: timestamp,
  };
  appendObject_(SHEETS.VENDORS, vendor);
  return vendor;
}

function publicRecord_(row) {
  const result = {};
  Object.keys(row).forEach(function (key) { if (key !== '_row') result[key] = row[key]; });
  return result;
}
