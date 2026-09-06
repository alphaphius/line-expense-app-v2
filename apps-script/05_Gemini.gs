function analyzeBillBlobs_(blobs, context) {
  const apiKey = getScriptProperty_(PROP_KEYS.GEMINI_API_KEY, true);
  const startedAt = Date.now();
  const parts = [{ text: buildGeminiPrompt_(context, blobs.length) }];
  blobs.forEach(function (blob) {
    parts.push({ inlineData: { mimeType: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) } });
  });

  const payload = {
    systemInstruction: {
      parts: [{ text: 'You are a precise Thai accounting-document extraction engine. Return only schema-valid JSON. Never invent unreadable values.' }],
    },
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: billResponseSchema_(),
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(APP_CONFIG.GEMINI_MODEL) + ':generateContent';
  let response;
  let parsedBody;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    parsedBody = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error('Gemini API: ' + cleanString_(parsedBody.error && parsedBody.error.message || response.getContentText(), 500));
    }
    const text = (((parsedBody.candidates || [])[0] || {}).content || {}).parts || [];
    const output = text.filter(function (part) { return !part.thought && part.text; }).map(function (part) { return part.text; }).join('');
    if (!output) throw new Error('Gemini ไม่ส่งข้อมูลกลับมา');
    const result = validateAiResult_(JSON.parse(output), context);
    logAiUsage_(parsedBody.usageMetadata || {}, Date.now() - startedAt, true, '', context.billId);
    return result;
  } catch (error) {
    logAiUsage_((parsedBody && parsedBody.usageMetadata) || {}, Date.now() - startedAt, false, error.message, context.billId);
    throw error;
  }
}

function buildGeminiPrompt_(context, pageCount) {
  const receivedDate = toIsoDate_(context && context.receivedDate) || todayIso_();
  const normalDateRange = billDateNormalRange_(receivedDate);
  const companies = (context.companies || []).map(function (company) {
    return { id: company.company_id, name: company.company_name, branch: company.branch_name, tax_id: company.tax_id, address: company.address };
  });
  const categories = (context.categories || []).map(function (category) {
    return { id: category.category_id, name: category.category_name, aliases: category.aliases };
  });
  return [
    'อ่านเอกสารค่าใช้จ่ายภาษาไทยจำนวน ' + pageCount + ' หน้า ซึ่งอาจเป็นเอกสารชุดเดียวกัน',
    'รวมรายการต่อเนื่องจากหลายหน้าเป็นบิลเดียว และอย่านับยอดรวม/รายการซ้ำจากหน้าถัดไป',
    'ชนิดเอกสาร: TAX_INVOICE, RECEIPT, CASH_BILL, INVOICE, DELIVERY_NOTE, TOLL, TRANSFER_SLIP, OTHER',
    'วันที่ต้องคืนเป็น YYYY-MM-DD ค.ศ. เท่านั้น ถ้าเห็น พ.ศ. ให้ลบ 543 และห้ามเดาตัวเลขที่อ่านไม่ออก',
    'วันที่รับเอกสารเข้าระบบคือ ' + receivedDate + ' ใช้เป็นข้อมูลอ้างอิงเท่านั้น ห้ามนำมาใส่ document_date แทนวันที่บนบิล',
    'ถ้าไม่เห็นวันที่พิมพ์หรือระบุบนเอกสารอย่างชัดเจน หรืออ่านวัน เดือน ปีไม่ได้ครบ ให้คืน document_date เป็นค่าว่าง ห้ามคาดเดาจากวันที่รับเอกสาร ชื่อไฟล์ หรือลำดับรูป',
    'บัตร/ใบผ่านทางไทยอาจใช้รูเจาะระบุวันเดือนปี ให้พิจารณาตำแหน่งรูอย่างระมัดระวัง หากไม่แน่ใจให้เว้นวันที่ว่างและ needs_review=true',
    'ช่วงวันที่ที่พบตามปกติคือ ' + normalDateRange.minimum + ' ถึง ' + normalDateRange.maximum + ' หากอยู่นอกช่วงนี้ให้ตรวจวัน เดือน และปีซ้ำอย่างเข้มงวด และตั้ง needs_review=true เมื่อยังไม่แน่ใจ',
    'ตรวจผู้ซื้อกับรายชื่อบริษัท โดยเน้นเลขผู้เสียภาษี 13 หลักก่อนชื่อและที่อยู่',
    'ถ้าภาพเบลอ มืด ตัดขอบ มีแสงสะท้อน หรือข้อมูลสำคัญอ่านไม่ได้ ให้ quality_score ต่ำกว่า 70, needs_review=true และระบุเหตุผลภาษาไทย',
    'เลือก company_id และ category_id จากรายการที่ให้เท่านั้น ถ้าไม่ตรงให้เป็นค่าว่าง',
    'ยอดเงินเป็นตัวเลข ไม่ใส่ comma/currency; ช่องไม่พบใช้ค่าว่างหรือ 0 ตามชนิดข้อมูล',
    'บริษัท: ' + JSON.stringify(companies),
    'หมวดหมู่: ' + JSON.stringify(categories),
  ].join('\n');
}

function billResponseSchema_() {
  const string = function (description) { return { type: 'string', description: description || '' }; };
  const number = function (description) { return { type: 'number', description: description || '' }; };
  const boolean = function (description) { return { type: 'boolean', description: description || '' }; };
  return {
    type: 'object', additionalProperties: false,
    properties: {
      doc_type: Object.assign(string('Document type'), { enum: ['TAX_INVOICE', 'RECEIPT', 'CASH_BILL', 'INVOICE', 'DELIVERY_NOTE', 'TOLL', 'TRANSFER_SLIP', 'OTHER'] }),
      document_no: string(), document_date: string('YYYY-MM-DD or empty'), due_date: string('YYYY-MM-DD or empty'),
      vendor_name: string(), vendor_tax_id: string(), vendor_branch: string(), vendor_address: string(),
      buyer_name: string(), buyer_tax_id: string(), buyer_address: string(), company_id: string(), category_id: string(),
      currency: string(), subtotal: number(), discount: number(), vat_rate: number(), vat_amount: number(), withholding_tax: number(), grand_total: number(),
      payment_method: string(), description: string(), notes: string(),
      image_quality: Object.assign(string(), { enum: ['CLEAR', 'FAIR', 'POOR'] }), quality_score: number('0-100'),
      needs_review: boolean(), review_reasons: { type: 'array', items: string() }, company_match: boolean(), tax_id_match: boolean(),
      items: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: { description: string(), quantity: number(), unit: string(), unit_price: number(), discount: number(), vat_amount: number(), amount: number(), sku: string() },
          required: ['description', 'quantity', 'unit', 'unit_price', 'discount', 'vat_amount', 'amount', 'sku'],
        },
      },
    },
    required: ['doc_type', 'document_no', 'document_date', 'due_date', 'vendor_name', 'vendor_tax_id', 'vendor_branch', 'vendor_address',
      'buyer_name', 'buyer_tax_id', 'buyer_address', 'company_id', 'category_id', 'currency', 'subtotal', 'discount', 'vat_rate',
      'vat_amount', 'withholding_tax', 'grand_total', 'payment_method', 'description', 'notes', 'image_quality', 'quality_score',
      'needs_review', 'review_reasons', 'company_match', 'tax_id_match', 'items'],
  };
}

function validateAiResult_(result, context) {
  context = context || {};
  const allowedCompanyIds = (context.companies || []).map(function (item) { return String(item.company_id); });
  const allowedCategoryIds = (context.categories || []).map(function (item) { return String(item.category_id); });
  result.company_id = allowedCompanyIds.indexOf(String(result.company_id)) >= 0 ? String(result.company_id) : '';
  result.category_id = allowedCategoryIds.indexOf(String(result.category_id)) >= 0 ? String(result.category_id) : '';
  const extractedDocumentDate = toIsoDate_(result.document_date);
  const documentDateMissing = !extractedDocumentDate;
  const receivedDate = toIsoDate_(context.receivedDate) || todayIso_();
  result.document_date = extractedDocumentDate || receivedDate;
  result.due_date = toIsoDate_(result.due_date);
  result.vendor_tax_id = normalizeTaxId_(result.vendor_tax_id);
  result.buyer_tax_id = normalizeTaxId_(result.buyer_tax_id);
  ['subtotal', 'discount', 'vat_rate', 'vat_amount', 'withholding_tax', 'grand_total', 'quality_score'].forEach(function (key) { result[key] = toNumber_(result[key]); });
  result.quality_score = Math.max(0, Math.min(100, result.quality_score));
  result.review_reasons = Array.isArray(result.review_reasons) ? result.review_reasons.map(function (x) { return cleanString_(x, 150); }).filter(Boolean) : [];
  const dateWarning = billDateReviewWarning_(result.document_date, receivedDate);
  result.review_reasons = refreshBillDateReviewReasons_(result.review_reasons, dateWarning, { preserveMissingFallback: documentDateMissing });
  if (documentDateMissing) {
    const missingDateReason = missingBillDateFallbackReason_(receivedDate);
    if (result.review_reasons.indexOf(missingDateReason) < 0) result.review_reasons.push(missingDateReason);
  }
  result.needs_review = toBoolean_(result.needs_review) || documentDateMissing || result.quality_score < 70 || !result.vendor_name || !!dateWarning;
  result.document_date_missing = documentDateMissing;
  if (result.quality_score < 70 && result.review_reasons.indexOf('รูปภาพไม่ชัด กรุณาตรวจสอบข้อมูลก่อนยืนยัน') < 0) {
    result.review_reasons.push('รูปภาพไม่ชัด กรุณาตรวจสอบข้อมูลก่อนยืนยัน');
  }
  result.items = Array.isArray(result.items) ? result.items.slice(0, 200) : [];
  return result;
}

function logAiUsage_(usage, latencyMs, success, error, billId) {
  appendObject_(SHEETS.AI_USAGE, {
    usage_id: uuid_(), bill_id: cleanString_(billId), model: APP_CONFIG.GEMINI_MODEL, prompt_version: APP_CONFIG.GEMINI_PROMPT_VERSION,
    input_tokens: toNumber_(usage.promptTokenCount), output_tokens: toNumber_(usage.candidatesTokenCount),
    thought_tokens: toNumber_((usage.thoughtsTokenCount || 0)), total_tokens: toNumber_(usage.totalTokenCount),
    latency_ms: latencyMs, success: success, error: cleanString_(error, 500), created_at: nowIso_(),
  });
}
