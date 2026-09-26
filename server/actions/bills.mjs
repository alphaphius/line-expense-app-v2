import { config } from '../config.mjs';
import { execute, one, select, transaction } from '../db.mjs';
import { readBuffer, removeFile, storeBuffer, storeCompressedImage } from '../files.mjs';
import { createBillXlsx, createSimpleBillDocx, DOCX_MIME, XLSX_MIME } from '../exports.mjs';
import { apiError, bool, clean, normalizeDate, normalizePeriod, nowSql, number, publicRow, token, uuid } from '../utils.mjs';
import { enrichBill } from './masters.mjs';

const BILL_FIELDS = ['project_id','company_id','category_id','doc_type','document_no','document_date','due_date','vendor_name','vendor_tax_id','vendor_branch','vendor_address','buyer_name','buyer_tax_id','buyer_address','currency','subtotal','discount','vat_rate','vat_amount','withholding_tax','grand_total','payment_method','description','notes'];

const thaiNormalize = value => clean(value, 1000).toLowerCase().replace(/[\s.,()\-_/]/g, '').replace(/กรุงเทพมหานคร/g, 'กรุงเทพ');
const taxId = value => clean(value, 30).replace(/\D/g, '').slice(0, 13);
const sqlDate = value => normalizeDate(value);

const companyNameCore = value => thaiNormalize(value)
  .replace(/^บริษัท/, '')
  .replace(/สำนักงานใหญ่/g, '')
  .replace(/จำกัด/g, '')
  .replace(/มหาชน/g, '')
  .replace(/สาขาที่\d+/g, '')
  .replace(/สาขา/g, '');

export function companyNamesMatch(expectedName, actualName, expectedBranch = '', expectedTax = '', actualTax = '') {
  const expected = thaiNormalize(`${expectedName || ''}${expectedBranch || ''}`);
  const actual = thaiNormalize(actualName);
  if (!expected || !actual) return false;
  if (expected.includes('มหาชน') && !actual.includes('มหาชน')) return false;
  const expectedCore = companyNameCore(expectedName);
  const actualCore = companyNameCore(actualName);
  if (expectedCore.length < 6 || expectedCore !== actualCore) return false;
  if (expected.includes('สำนักงานใหญ่') && !actual.includes('สำนักงานใหญ่')) {
    const expectedTaxId = taxId(expectedTax);
    const actualTaxId = taxId(actualTax);
    // OCR มักตัดคำในวงเล็บท้ายชื่อออก แม้ข้อความบนบิลมีอยู่จริง
    // ยอมให้ผ่านได้เฉพาะเมื่อแกนชื่อเท่ากันทุกตัวและเลขภาษี 13 หลักตรงกันเท่านั้น
    return !!expectedTaxId && expectedTaxId === actualTaxId;
  }
  return true;
}

function bangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

export function normalizeCurrentYearBillDate(value, fallbackDate = '') {
  const current = bangkokDateParts();
  const currentYear = Number(current.year);
  const fallback = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(fallbackDate, 10));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value, 10));
  if (!match) return fallback ? `${currentYear}-${fallback[2]}-${fallback[3]}` : '';
  let sourceYear = Number(match[1]);
  if (sourceYear >= 2400) sourceYear -= 543;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return fallback ? `${currentYear}-${fallback[2]}-${fallback[3]}` : '';
  const lastDay = new Date(Date.UTC(currentYear, month, 0)).getUTCDate();
  return `${currentYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

async function billOwner(userId) {
  if (!userId) return null;
  return one("SELECT user_id, display_name AS line_display_name, workhub_name, COALESCE(NULLIF(workhub_name, ''), NULLIF(display_name, ''), 'ผู้ส่งผ่าน LINE') AS owner_name FROM line_users WHERE user_id=:id", { id:userId });
}

const addressCanonical = value => clean(value, 1200)
  .toLowerCase()
  .replace(/กรุงเทพมหานคร|กรุงเทพฯ|กทม\.?/g, 'กรุงเทพ')
  .replace(/(?:ที่อยู่|เลขที่|หมู่ที่|หมู่|ซอย|ถนน|แขวง|เขต|ตำบล|อำเภอ|จังหวัด)/g, ' ')
  .replace(/\b(?:moo|soi|road|subdistrict|district|province)\b/gi, ' ')
  .replace(/[^0-9a-zก-๙]+/g, '');

const addressTokens = value => clean(value, 1200)
  .toLowerCase()
  .replace(/กรุงเทพมหานคร|กรุงเทพฯ|กทม\.?/g, ' กรุงเทพ ')
  .replace(/(?:ที่อยู่|เลขที่|หมู่ที่|หมู่|ซอย|ถนน|แขวง|เขต|ตำบล|อำเภอ|จังหวัด)/g, ' ')
  .replace(/\b(?:moo|soi|road|subdistrict|district|province)\b/gi, ' ')
  .split(/[^0-9a-zก-๙]+/)
  .filter(tokenValue => tokenValue.length >= 2);

export function addressesMatch(expected, actual) {
  const left = addressCanonical(expected);
  const right = addressCanonical(actual);
  if (left.length < 8 || right.length < 8) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const expectedTokens = new Set(addressTokens(expected));
  const actualTokens = new Set(addressTokens(actual));
  if (!expectedTokens.size || !actualTokens.size) return false;
  const overlap = [...expectedTokens].filter(tokenValue => actualTokens.has(tokenValue)).length;
  return overlap / Math.min(expectedTokens.size, actualTokens.size) >= 0.7;
}

export function normalizeQualityScore(value) {
  const raw = number(value);
  const percent = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(percent * 1000) / 1000));
}

const GEMINI_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function classifyGeminiFailure(error = {}) {
  const status = Number(error.geminiStatus || 0);
  const message = clean(error.message, 500);
  const retryable = GEMINI_RETRYABLE_STATUS.has(status) || /high demand|overload|temporar|timeout|timed out|fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(message);
  const code = status === 429 ? 'GEMINI_RATE_LIMIT' : status === 503 ? 'GEMINI_HIGH_DEMAND' : retryable ? 'GEMINI_TEMPORARY' : 'GEMINI_ACTION_REQUIRED';
  const userMessage = status === 429
    ? 'Gemini ใช้งานครบโควตาหรือมีคำขอมากเกินไป ระบบจะลองใหม่อัตโนมัติ'
    : status === 503 || /high demand|overload/i.test(message)
      ? 'Gemini มีผู้ใช้งานหนาแน่น ระบบเก็บรูปไว้แล้วและจะลองใหม่อัตโนมัติ'
      : retryable
        ? 'การเชื่อมต่อ Gemini ขัดข้องชั่วคราว ระบบจะลองใหม่อัตโนมัติ'
        : 'Gemini ปฏิเสธคำขอ กรุณาให้ผู้ดูแลตรวจ API key หรือการตั้งค่าโมเดล';
  return { status, retryable, code, userMessage };
}

export function billAiRetryDelayMs(attempt) {
  return [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000][Math.max(0, Math.min(4, Number(attempt) - 1))];
}

async function analyzeWithGemini(images, context, model = config.geminiModel) {
  if (!config.geminiApiKey) throw apiError('GEMINI_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY บน NAS', 503);
  const schema = {
    type:'object', additionalProperties:false,
    properties:{
      doc_type:{type:'string',enum:['TAX_INVOICE','RECEIPT','CASH_BILL','INVOICE','DELIVERY_NOTE','TOLL','TRANSFER_SLIP','OTHER']},
      document_no:{type:'string'},document_date:{type:'string'},due_date:{type:'string'},vendor_name:{type:'string'},vendor_tax_id:{type:'string'},vendor_branch:{type:'string'},vendor_address:{type:'string'},buyer_name:{type:'string'},buyer_tax_id:{type:'string'},buyer_address:{type:'string'},company_id:{type:'string'},category_id:{type:'string'},currency:{type:'string'},subtotal:{type:'number'},discount:{type:'number'},vat_rate:{type:'number'},vat_amount:{type:'number'},withholding_tax:{type:'number'},grand_total:{type:'number'},payment_method:{type:'string'},description:{type:'string'},notes:{type:'string'},image_quality:{type:'string',enum:['CLEAR','FAIR','POOR']},quality_score:{type:'number'},needs_review:{type:'boolean'},review_reasons:{type:'array',items:{type:'string'}},company_match:{type:'boolean'},tax_id_match:{type:'boolean'},items:{type:'array',items:{type:'object',additionalProperties:false,properties:{description:{type:'string'},quantity:{type:'number'},unit:{type:'string'},unit_price:{type:'number'},discount:{type:'number'},vat_amount:{type:'number'},amount:{type:'number'},sku:{type:'string'}},required:['description','quantity','unit','unit_price','discount','vat_amount','amount','sku']}}
    },
    required:['doc_type','document_no','document_date','due_date','vendor_name','vendor_tax_id','vendor_branch','vendor_address','buyer_name','buyer_tax_id','buyer_address','company_id','category_id','currency','subtotal','discount','vat_rate','vat_amount','withholding_tax','grand_total','payment_method','description','notes','image_quality','quality_score','needs_review','review_reasons','company_match','tax_id_match','items']
  };
  const prompt = [
    `อ่านเอกสารค่าใช้จ่ายภาษาไทย ${images.length} หน้าเป็นบิลเดียว รวมรายการต่อเนื่องและอย่านับยอดซ้ำ`,
    'กรณีรูปหนึ่งรูปเป็นกระดาษที่แปะใบเสร็จหรือบัตรค่าผ่านทางหลายใบ ให้ถือรูปนั้นเป็นบิลหนึ่งรายการ แต่ต้องอ่านใบย่อยทุกใบและบวกยอดที่ต้องชำระของทุกใบเป็น grand_total',
    'สำหรับเอกสารที่มีใบย่อยหลายใบ ให้สร้าง items อย่างน้อยหนึ่งรายการต่อใบย่อย ระบุรายละเอียดที่แยกแต่ละใบได้ และรวม subtotal, discount, vat_amount, withholding_tax และ grand_total จากใบย่อยทั้งหมดตามชนิดยอดนั้น',
    'ห้ามบวกยอดซ้ำภายในใบย่อยเดียวกัน: ยอดก่อนภาษี VAT และยอดสุทธิที่พิมพ์ซ้ำเป็นสรุปของใบเดียวกัน ไม่ใช่คนละรายการ หากมีทั้งยอดรายการและยอดรวม ให้ใช้ยอดรวมของใบย่อยเพียงครั้งเดียว',
    'ถ้าในภาพมีใบย่อยหลายใบ ให้เขียนจำนวนใบย่อยที่พบไว้ใน notes เพื่อให้ผู้ใช้ตรวจสอบได้ เช่น “พบใบเสร็จย่อย 4 ใบในภาพ”',
    `วันที่รับเข้า ${context.receivedDate} ใช้อ้างอิงเท่านั้น วันที่เอกสารต้องเป็น YYYY-MM-DD ค.ศ. ถ้าอ่านไม่ครบให้ค่าว่าง ห้ามเดา`,
    `ระบบรับเฉพาะบิลปีปัจจุบัน ${context.receivedDate.slice(0,4)} หากเอกสารพิมพ์ปี พ.ศ. ให้แปลงเป็น ค.ศ. ก่อนส่งกลับ โดยระบบจะปรับปีอื่นเป็นปีปัจจุบันอีกครั้ง`,
    `วันที่ที่ผู้อัปโหลดกำหนดเอง: ${context.requestedDate || 'ไม่ได้ระบุ'} ถ้ามีค่านี้ ให้ยังอ่านวันที่จากเอกสารตามจริง แต่ไม่ต้องแจ้งตรวจสอบเฉพาะเรื่องวันที่ เพราะระบบจะใช้วันที่ที่ผู้ใช้กำหนด`,
    'แยกข้อมูลผู้ขายกับผู้ซื้อให้ชัด: ข้อมูลหัวเอกสารก่อนช่องชื่อ/ที่อยู่มักเป็นผู้ขาย ส่วนชื่อและที่อยู่หลังป้าย "ชื่อ" และ "ที่อยู่" คือบริษัทผู้ซื้อ',
    'อ่าน buyer_name, buyer_tax_id และ buyer_address จากส่วนผู้ซื้อบนเอกสารให้ครบทุกบรรทัด โดยเน้นเลขผู้เสียภาษี 13 หลักก่อน แล้วอ่านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด และรหัสไปรษณีย์ ช่องอ่านไม่ได้ใช้ค่าว่างหรือ 0 ห้ามคัดลอกจากข้อมูลบริษัทอ้างอิง',
    'ห้ามตัดคำว่า “มหาชน” หรือ “สำนักงานใหญ่” ออกจาก buyer_name และห้ามใช้ company_id เป็นหลักฐานว่าชื่อบริษัทตรง ระบบจะตรวจข้อความชื่อและเลขผู้เสียภาษีเอง',
    'quality_score ต้องเป็นคะแนนเต็ม 100 (0 ถึง 100 เท่านั้น เช่น ภาพชัดมากให้ 95-100) ห้ามใช้สเกล 0 ถึง 1',
    'ถ้าภาพไม่ชัดหรือข้อมูลสำคัญไม่ครบ ให้ needs_review=true และเขียนเหตุผลภาษาไทย',
    `บริษัท: ${JSON.stringify(context.companies.map(item=>({id:item.company_id,name:item.company_name,branch:item.branch_name,tax_id:item.tax_id,address:item.address})))}`,
    `หมวดหมู่: ${JSON.stringify(context.categories.map(item=>({id:item.category_id,name:item.category_name,aliases:item.aliases})))}`,
  ].join('\n');
  const started = Date.now();
  let responseBody = {};
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method:'POST', headers:{'content-type':'application/json','x-goog-api-key':config.geminiApiKey},
      body:JSON.stringify({ systemInstruction:{parts:[{text:'You are a precise Thai accounting-document extraction engine. Return only schema-valid JSON. Never invent unreadable values.'}]}, contents:[{role:'user',parts:[{text:prompt},...images.map(image=>({inlineData:{mimeType:'image/jpeg',data:image.buffer.toString('base64')}}))]}], generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:4096,thinkingConfig:{thinkingLevel:'minimal'}} }),
      signal:AbortSignal.timeout(300000),
    });
    responseBody = await response.json();
    if (!response.ok) {
      const geminiError = new Error(clean(responseBody?.error?.message || `Gemini HTTP ${response.status}`, 500));
      geminiError.geminiStatus = response.status;
      throw geminiError;
    }
    const output = (responseBody.candidates?.[0]?.content?.parts || []).filter(part=>!part.thought && part.text).map(part=>part.text).join('');
    if (!output) throw new Error('Gemini ไม่ส่งข้อมูลกลับมา');
    const result = JSON.parse(output);
    const allowedCompanies = new Set(context.companies.map(item=>String(item.company_id)));
    const allowedCategories = new Set(context.categories.map(item=>String(item.category_id)));
    result.company_id = allowedCompanies.has(String(result.company_id)) ? String(result.company_id) : '';
    result.category_id = allowedCategories.has(String(result.category_id)) ? String(result.category_id) : '';
    const rawExtractedDate = clean(result.document_date, 20);
    const parsedExtractedDate = normalizeCurrentYearBillDate(rawExtractedDate);
    const extractedDate = parsedExtractedDate || context.receivedDate;
    const requestedDate = context.requestedDate ? normalizeCurrentYearBillDate(context.requestedDate, context.receivedDate) : '';
    result.document_date = requestedDate || extractedDate || context.receivedDate;
    result.due_date = sqlDate(result.due_date);
    result.vendor_tax_id = taxId(result.vendor_tax_id);
    result.buyer_tax_id = taxId(result.buyer_tax_id);
    result.review_reasons = Array.isArray(result.review_reasons) ? result.review_reasons.map(value=>clean(value,180)).filter(Boolean) : [];
    if (requestedDate) result.review_reasons = result.review_reasons.filter(reason => !/วันที่.*(?:ไม่|อ่าน|ชัด|พบ)/i.test(reason));
    else if (!parsedExtractedDate) result.review_reasons.push(`ไม่พบวันที่เอกสารชัดเจน ระบบใช้วันที่รับเข้า ${context.receivedDate} ชั่วคราว`);
    result.quality_score = normalizeQualityScore(result.quality_score);
    result.needs_review = result.review_reasons.length > 0 || (!requestedDate && !parsedExtractedDate) || result.quality_score < 70 || !clean(result.vendor_name);
    result.items = Array.isArray(result.items) ? result.items.slice(0,200) : [];
    await execute('INSERT INTO ai_usage (usage_id,bill_id,model,prompt_version,input_tokens,output_tokens,thought_tokens,total_tokens,latency_ms,success,error,created_at) VALUES (:id,:bill,:model,:prompt,:input,:output,:thought,:total,:latency,1,\'\',:created)', { id:uuid(), bill:context.billId, model, prompt:'bill-th-nas-v2-queue', input:number(responseBody.usageMetadata?.promptTokenCount), output:number(responseBody.usageMetadata?.candidatesTokenCount), thought:number(responseBody.usageMetadata?.thoughtsTokenCount), total:number(responseBody.usageMetadata?.totalTokenCount), latency:Date.now()-started, created:nowSql() });
    return result;
  } catch (error) {
    await execute('INSERT INTO ai_usage (usage_id,bill_id,model,prompt_version,input_tokens,output_tokens,thought_tokens,total_tokens,latency_ms,success,error,created_at) VALUES (:id,:bill,:model,:prompt,0,0,0,0,:latency,0,:error,:created)', { id:uuid(), bill:context.billId, model, prompt:'bill-th-nas-v2-queue', latency:Date.now()-started, error:clean(error.message,500), created:nowSql() });
    const wrapped = apiError('GEMINI_ERROR', `Gemini วิเคราะห์ไม่สำเร็จ: ${clean(error.message,400)}`, 502);
    wrapped.geminiStatus = Number(error.geminiStatus || 0);
    throw wrapped;
  }
}

async function getVendor(connection, ai, timestamp) {
  const normalizedName = thaiNormalize(ai.vendor_name);
  const normalizedTax = taxId(ai.vendor_tax_id);
  const [rows] = await connection.execute('SELECT * FROM vendors WHERE (tax_id <> \'\' AND tax_id = ?) OR (tax_id = \'\' AND normalized_name = ?) LIMIT 1 FOR UPDATE', [normalizedTax, normalizedName]);
  if (rows[0]) {
    await connection.execute('UPDATE vendors SET vendor_name=?,normalized_name=?,tax_id=?,branch_name=?,address=?,use_count=use_count+1,last_used_at=?,updated_at=? WHERE vendor_id=?', [clean(ai.vendor_name,255),normalizedName,normalizedTax,clean(ai.vendor_branch,160),clean(ai.vendor_address,1000),timestamp,timestamp,rows[0].vendor_id]);
    return rows[0].vendor_id;
  }
  const id=uuid();
  await connection.execute('INSERT INTO vendors (vendor_id,vendor_name,normalized_name,tax_id,branch_name,address,use_count,last_used_at,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)',[id,clean(ai.vendor_name||'ไม่ทราบชื่อ',255),normalizedName,normalizedTax,clean(ai.vendor_branch,160),clean(ai.vendor_address,1000),timestamp,timestamp,timestamp]);
  return id;
}

export async function submitBillPages(payload = {}, {lineSessionId=null} = {}) {
  if(lineSessionId){
    const existing=await one('SELECT j.job_id FROM bill_ai_jobs j JOIN bills b ON b.bill_id=j.bill_id WHERE b.line_session_id=:id',{id:lineSessionId});
    if(existing)return getBillAiJob(existing.job_id);
  }
  const projectId=clean(payload.project_id,64); const companyId=clean(payload.company_id,64);
  const source=clean(payload.source||'WEB',32).toUpperCase();
  const requestedDateInput=clean(payload.document_date,20);
  const requestedDate=requestedDateInput?normalizeCurrentYearBillDate(requestedDateInput):'';
  if(requestedDateInput&&!requestedDate)throw apiError('INVALID_DOCUMENT_DATE','วันที่ในบิลที่ระบุไม่ถูกต้อง');
  let sourceUserId=clean(payload.source_user_id,160),sourceUserName=clean(payload.source_user_name,255);
  const files=Array.isArray(payload.files)?payload.files:[];
  const expected=Math.max(1,Math.min(config.maxPagesPerBill,Number(payload.expected_pages)||files.length||1));
  if (!projectId || !companyId) throw apiError('REQUIRED_FIELDS','กรุณาเลือกโครงการและบริษัท');
  if (!files.length || files.length!==expected || files.length>config.maxPagesPerBill) throw apiError('INVALID_PAGE_COUNT',`กรุณาเลือก 1-${config.maxPagesPerBill} รูป และจำนวนหน้าต้องตรงกัน`);
  const [project,company,categories,companies]=await Promise.all([one('SELECT * FROM projects WHERE project_id=:id AND active=1',{id:projectId}),one('SELECT * FROM companies WHERE company_id=:id AND active=1',{id:companyId}),select('SELECT * FROM categories WHERE active=1'),select('SELECT * FROM companies WHERE active=1')]);
  if(!project||!company) throw apiError('MASTER_NOT_FOUND','ไม่พบโครงการหรือบริษัทที่เลือก');
  if(source==='WEB'){
    const owner=await billOwner(sourceUserId);
    if(!owner)throw apiError('BILL_OWNER_REQUIRED','กรุณาเลือกเจ้าของบิลจากรายชื่อผู้ที่เคยส่งบิลผ่าน LINE');
    sourceUserId=owner.user_id;sourceUserName=clean(owner.owner_name,255)||'ผู้ส่งผ่าน LINE';
  } else if(source==='LINE') {
    if(!sourceUserId) throw apiError('LINE_OWNER_REQUIRED','ไม่พบ LINE userId ของผู้ส่งบิล');
    const owner=await billOwner(sourceUserId);
    sourceUserName=clean(owner?.owner_name||sourceUserName,255)||'ผู้ส่งผ่าน LINE';
  }
  const billId=uuid(); const sessionId=uuid(); const jobId=uuid(); const stored=[];
  try {
    for(let index=0;index<files.length;index+=1){const file=files[index]||{}; stored.push(await storeCompressedImage('uploads',clean(file.name||file.fileName,180)||`bill-page-${index+1}.jpg`,file.dataUrl||file.data_url,{maxLongEdge:1800,quality:80}));}
    const receivedParts=bangkokDateParts();
    const receivedDate=`${receivedParts.year}-${receivedParts.month}-${receivedParts.day}`;
    const timestamp=nowSql();
    await transaction(async connection=>{
      if(lineSessionId){
        const [sessions]=await connection.execute("SELECT session_id FROM upload_sessions WHERE session_id=? AND source='LINE' AND source_user_id=? AND source_context_id=? FOR UPDATE",[lineSessionId,sourceUserId,clean(payload.source_context_id,160)]);
        if(!sessions.length)throw new Error('ไม่พบชุดรูป LINE ของผู้ส่ง');
        const [existing]=await connection.execute('SELECT j.job_id FROM bill_ai_jobs j JOIN bills b ON b.bill_id=j.bill_id WHERE b.line_session_id=?',[lineSessionId]);
        if(existing.length){const duplicate=new Error('LINE session already submitted');duplicate.existingJobId=existing[0].job_id;throw duplicate;}
      }
      await connection.execute('INSERT INTO upload_sessions (session_id,project_id,company_id,expected_pages,received_pages,status,source,source_user_id,source_context_id,created_at,expires_at,updated_at) VALUES (?,?,?,?,?,\'AI_QUEUED\',?,?,?,?,DATE_ADD(?,INTERVAL 24 HOUR),?)',[sessionId,projectId,companyId,expected,files.length,source,sourceUserId,clean(payload.source_context_id,160),timestamp,timestamp,timestamp]);
      const values={ bill_id:billId,session_id:sessionId,project_id:projectId,company_id:companyId,category_id:'',doc_type:'',document_no:'',document_date:requestedDate||receivedDate,due_date:null,vendor_id:'',vendor_name:'กำลังรอ AI วิเคราะห์',vendor_tax_id:'',vendor_branch:'',vendor_address:'',buyer_name:'',buyer_tax_id:'',buyer_address:'',currency:'THB',subtotal:0,discount:0,vat_rate:0,vat_amount:0,withholding_tax:0,grand_total:0,payment_method:'',description:'',notes:'',page_count:expected,image_quality:'',quality_score:0,needs_review:1,review_reasons:JSON.stringify(['รูปถูกเก็บแล้ว กำลังรอ Gemini วิเคราะห์']),company_match:null,tax_id_match:null,address_match:null,duplicate_key:'',status:'AI_QUEUED',source,source_user_id:sourceUserId,source_user_name:sourceUserName,source_context_id:clean(payload.source_context_id,160),folder_path:stored[0].relative.split('/').slice(0,-1).join('/'),created_at:timestamp,updated_at:timestamp };
      values.line_session_id=lineSessionId;
      const columns=Object.keys(values); await connection.execute(`INSERT INTO bills (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,Object.values(values));
      for(let index=0;index<stored.length;index+=1){const item=stored[index];await connection.execute('INSERT INTO bill_documents (doc_id,bill_id,session_id,page_no,file_path,file_name,mime_type,sha256,size_bytes,original_size_bytes,compression,width,height,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[uuid(),billId,sessionId,index+1,item.relative,item.relative.split('/').pop(),item.mime,item.sha256,item.size,item.originalSize,item.compression,item.width,item.height,timestamp]);}
      await connection.execute("INSERT INTO bill_ai_jobs (job_id,bill_id,requested_document_date,status,attempts,max_attempts,model,fallback_model,error_code,last_error,status_message,next_attempt_at,created_at,updated_at) VALUES (?,?,?,'AI_QUEUED',0,?,?,?,?,?,'เก็บรูปเรียบร้อยแล้ว กำลังรอ Gemini วิเคราะห์',?,?,?)",[jobId,billId,requestedDate||null,config.billAiMaxAttempts,config.geminiModel,config.geminiFallbackModel,'','',timestamp,timestamp,timestamp]);
      await connection.execute('INSERT INTO audit_logs (log_id,entity_type,entity_id,action,actor,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)',[uuid(),'bill',billId,'AI_QUEUED',sourceUserId||'WEB',null,JSON.stringify({job_id:jobId,page_count:expected,status:'AI_QUEUED'}),timestamp]);
      if(lineSessionId)await connection.execute("UPDATE upload_sessions SET status='COMPLETED',updated_at=? WHERE session_id=?",[timestamp,lineSessionId]);
    });
    return getBillAiJob(jobId);
  }catch(error){await Promise.all(stored.map(item=>removeFile(item.relative)));if(error.existingJobId)return getBillAiJob(error.existingJobId);throw error;}
}

function nextAttemptSql(delayMs) { return new Date(Date.now()+delayMs).toISOString().slice(0,23).replace('T',' '); }

export async function getBillAiJob(jobId) {
  const row=await one(`SELECT j.*,b.source,b.source_user_id,b.source_user_name,b.source_context_id,b.project_id,b.company_id,b.page_count
    FROM bill_ai_jobs j JOIN bills b ON b.bill_id=j.bill_id WHERE j.job_id=:id`,{id:clean(jobId,64)});
  if(!row)throw apiError('BILL_AI_JOB_NOT_FOUND','ไม่พบคิววิเคราะห์บิล',404);
  return publicRow(row);
}

export async function listBillAiJobs(payload={}) {
  const limit=Math.max(1,Math.min(50,Number(payload.limit)||20));
  const rows=await select(`SELECT j.*,b.source,b.source_user_id,b.source_user_name,b.source_context_id,b.project_id,b.company_id,b.page_count
    FROM bill_ai_jobs j JOIN bills b ON b.bill_id=j.bill_id
    WHERE j.status<>'AI_COMPLETED' OR j.completed_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)
    ORDER BY j.created_at DESC LIMIT :limit`,{limit});
  return rows.map(publicRow);
}

async function finalizeBillAiJob(job, analysis) {
  const [bill,company]=await Promise.all([one('SELECT * FROM bills WHERE bill_id=:id',{id:job.bill_id}),one('SELECT * FROM companies WHERE company_id=:id',{id:job.company_id})]);
  if(!bill||!company)throw apiError('BILL_AI_CONTEXT_MISSING','ไม่พบข้อมูลบิลหรือบริษัทที่ใช้วิเคราะห์',409);
  const targetTax=taxId(company.tax_id); const buyerTax=taxId(analysis.buyer_tax_id);
  const taxMatch=!!targetTax&&targetTax===buyerTax;
  const companyMatch=companyNamesMatch(company.company_name,analysis.buyer_name,company.branch_name,company.tax_id,buyerTax);
  const addressMatch=addressesMatch(company.address,analysis.buyer_address);
  const duplicateKey=[taxId(analysis.vendor_tax_id)||thaiNormalize(analysis.vendor_name),clean(analysis.document_no,160),analysis.document_date,number(analysis.grand_total).toFixed(2)].join('|');
  const duplicate=await one("SELECT bill_id FROM bills WHERE duplicate_key=:key AND bill_id<>:id AND status NOT IN ('REJECTED','AI_QUEUED','AI_PROCESSING','AI_RETRY','AI_ACTION_REQUIRED') LIMIT 1",{key:duplicateKey,id:bill.bill_id});
  const reasons=[...(analysis.review_reasons||[])];
  if(duplicate)reasons.push(`อาจเป็นบิลซ้ำกับเลขที่ ${duplicate.bill_id}`);
  if(!companyMatch)reasons.push('ชื่อบริษัทผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
  if(!taxMatch)reasons.push('เลขผู้เสียภาษีผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
  if(!addressMatch)reasons.push('ที่อยู่ผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
  const needsReview=bool(analysis.needs_review)||!!duplicate||!companyMatch||!taxMatch||!addressMatch;
  const timestamp=nowSql();
  await transaction(async connection=>{
    const vendorId=await getVendor(connection,analysis,timestamp);
    const patch={category_id:clean(analysis.category_id,64),doc_type:clean(analysis.doc_type||'OTHER',80),document_no:clean(analysis.document_no,160),document_date:analysis.document_date,due_date:analysis.due_date,vendor_id:vendorId,vendor_name:clean(analysis.vendor_name,255)||'ไม่ทราบชื่อร้าน',vendor_tax_id:taxId(analysis.vendor_tax_id),vendor_branch:clean(analysis.vendor_branch,160),vendor_address:clean(analysis.vendor_address,1000),buyer_name:clean(analysis.buyer_name,255),buyer_tax_id:buyerTax,buyer_address:clean(analysis.buyer_address,1000),currency:clean(analysis.currency||'THB',12),subtotal:number(analysis.subtotal),discount:number(analysis.discount),vat_rate:number(analysis.vat_rate),vat_amount:number(analysis.vat_amount),withholding_tax:number(analysis.withholding_tax),grand_total:number(analysis.grand_total),payment_method:clean(analysis.payment_method,120),description:clean(analysis.description,2000),notes:clean(analysis.notes,2000),image_quality:clean(analysis.image_quality,40),quality_score:number(analysis.quality_score),needs_review:needsReview?1:0,review_reasons:JSON.stringify([...new Set(reasons)]),company_match:companyMatch?1:0,tax_id_match:taxMatch?1:0,address_match:addressMatch?1:0,duplicate_key:duplicateKey,status:needsReview?'NEEDS_REVIEW':'PENDING_CONFIRMATION',updated_at:timestamp};
    await connection.execute(`UPDATE bills SET ${Object.keys(patch).map(key=>`${key}=?`).join(',')} WHERE bill_id=?`,[...Object.values(patch),bill.bill_id]);
    await connection.execute('DELETE FROM bill_items WHERE bill_id=?',[bill.bill_id]);
    for(let index=0;index<(analysis.items||[]).length;index+=1){const item=analysis.items[index];await connection.execute('INSERT INTO bill_items (item_id,bill_id,line_no,description,quantity,unit,unit_price,discount,vat_amount,amount,sku) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[uuid(),bill.bill_id,index+1,clean(item.description,1000),number(item.quantity),clean(item.unit,80),number(item.unit_price),number(item.discount),number(item.vat_amount),number(item.amount),clean(item.sku,120)]);}
    await connection.execute("UPDATE bill_ai_jobs SET status='AI_COMPLETED',error_code='',last_error='',status_message='วิเคราะห์เสร็จแล้ว พร้อมตรวจสอบและยืนยันบิล',next_attempt_at=NULL,completed_at=?,updated_at=? WHERE job_id=?",[timestamp,timestamp,job.job_id]);
    await connection.execute("UPDATE upload_sessions SET status='COMPLETED',updated_at=? WHERE session_id=?",[timestamp,bill.session_id]);
    await connection.execute('INSERT INTO audit_logs (log_id,entity_type,entity_id,action,actor,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)',[uuid(),'bill',bill.bill_id,'AI_EXTRACT',bill.source_user_id||'WEB',JSON.stringify({status:bill.status}),JSON.stringify(patch),timestamp]);
  });
  return getBillDetail(bill.bill_id);
}

async function claimBillAiJob(jobId='') {
  const params={};
  let where="status IN ('AI_QUEUED','AI_RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=UTC_TIMESTAMP(3))";
  if(jobId){where+=' AND job_id=:id';params.id=clean(jobId,64);}
  const candidate=await one(`SELECT job_id FROM bill_ai_jobs WHERE ${where} ORDER BY next_attempt_at,created_at LIMIT 1`,params);
  if(!candidate)return null;
  const timestamp=nowSql();
  const result=await execute(`UPDATE bill_ai_jobs SET status='AI_PROCESSING',attempts=attempts+1,started_at=:started,updated_at=:updated WHERE job_id=:id AND status IN ('AI_QUEUED','AI_RETRY')`,{id:candidate.job_id,started:timestamp,updated:timestamp});
  if(result.affectedRows!==1)return null;
  await execute("UPDATE bills b JOIN bill_ai_jobs j ON j.bill_id=b.bill_id SET b.status='AI_PROCESSING',b.review_reasons=JSON_ARRAY('Gemini กำลังอ่านข้อมูลจากรูปบิล'),b.updated_at=:updated WHERE j.job_id=:id",{id:candidate.job_id,updated:timestamp});
  return getBillAiJob(candidate.job_id);
}

export async function processNextBillAiJob(jobId='') {
  const job=await claimBillAiJob(jobId);
  if(!job)return null;
  try {
    const [documents,companies,categories]=await Promise.all([select('SELECT * FROM bill_documents WHERE bill_id=:id ORDER BY page_no',{id:job.bill_id}),select('SELECT * FROM companies WHERE active=1'),select('SELECT * FROM categories WHERE active=1')]);
    if(!documents.length)throw apiError('BILL_IMAGES_MISSING','ไม่พบรูปบิลที่เก็บไว้ กรุณาอัปโหลดใหม่',409);
    const images=await Promise.all(documents.map(async item=>({buffer:await readBuffer(item.file_path)})));
    const receivedParts=bangkokDateParts(new Date(String(job.created_at).replace(' ','T')+'Z'));
    const receivedDate=`${receivedParts.year}-${receivedParts.month}-${receivedParts.day}`;
    const model=Number(job.attempts)>=3&&job.fallback_model?job.fallback_model:job.model;
    const analysis=await analyzeWithGemini(images,{companies,categories,billId:job.bill_id,receivedDate,requestedDate:job.requested_document_date||''},model);
    const currentBill=await one('SELECT status FROM bills WHERE bill_id=:id',{id:job.bill_id});
    if(currentBill?.status==='REJECTED'){
      await execute("UPDATE bill_ai_jobs SET status='AI_CANCELLED',status_message='ผู้ใช้ยกเลิกรายการนี้แล้ว',next_attempt_at=NULL,updated_at=:updated WHERE job_id=:id",{id:job.job_id,updated:nowSql()});
      return {job:await getBillAiJob(job.job_id),bill:null};
    }
    const bill=await finalizeBillAiJob(job,analysis);
    return {job:await getBillAiJob(job.job_id),bill};
  } catch(error) {
    const failure=classifyGeminiFailure(error);
    const canRetry=failure.retryable&&Number(job.attempts)<Number(job.max_attempts);
    const status=canRetry?'AI_RETRY':'AI_ACTION_REQUIRED';
    const delay=canRetry?billAiRetryDelayMs(job.attempts):0;
    const next=canRetry?nextAttemptSql(delay):null;
    const statusMessage=canRetry?`${failure.userMessage} ครั้งถัดไปประมาณ ${Math.ceil(delay/60000)||1} นาที`:failure.userMessage;
    const timestamp=nowSql();
    await transaction(async connection=>{
      await connection.execute('UPDATE bill_ai_jobs SET status=?,error_code=?,last_error=?,status_message=?,next_attempt_at=?,updated_at=? WHERE job_id=?',[status,failure.code,clean(error.message,1000),statusMessage,next,timestamp,job.job_id]);
      await connection.execute('UPDATE bills SET status=?,review_reasons=?,updated_at=? WHERE bill_id=?',[status,JSON.stringify([statusMessage]),timestamp,job.bill_id]);
      await connection.execute("UPDATE upload_sessions SET status=?,updated_at=? WHERE session_id=(SELECT session_id FROM bills WHERE bill_id=?)",[status,timestamp,job.bill_id]);
    });
    return {job:await getBillAiJob(job.job_id),bill:null};
  }
}

export async function retryBillAiJob(jobId) {
  const job=await getBillAiJob(jobId);
  if(job.status==='AI_COMPLETED')return job;
  const timestamp=nowSql();
  await transaction(async connection=>{
    await connection.execute("UPDATE bill_ai_jobs SET status='AI_QUEUED',attempts=0,error_code='',last_error='',status_message='รับคำสั่งแล้ว กำลังรอ Gemini วิเคราะห์ใหม่',next_attempt_at=?,completed_at=NULL,last_notified_status='',updated_at=? WHERE job_id=?",[timestamp,timestamp,job.job_id]);
    await connection.execute("UPDATE bills SET status='AI_QUEUED',review_reasons=JSON_ARRAY('รับคำสั่งแล้ว กำลังรอ Gemini วิเคราะห์ใหม่'),updated_at=? WHERE bill_id=?",[timestamp,job.bill_id]);
  });
  return getBillAiJob(job.job_id);
}

export async function recoverBillAiJobs() {
  const timestamp=nowSql();
  await execute("UPDATE bill_ai_jobs SET status='AI_RETRY',status_message='ระบบเริ่มทำงานใหม่และจะวิเคราะห์ต่ออัตโนมัติ',next_attempt_at=:next,updated_at=:updated WHERE status='AI_PROCESSING' AND updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)",{next:timestamp,updated:timestamp});
  await execute("UPDATE bills b JOIN bill_ai_jobs j ON j.bill_id=b.bill_id SET b.status=j.status,b.review_reasons=JSON_ARRAY(j.status_message),b.updated_at=:updated WHERE j.status IN ('AI_QUEUED','AI_RETRY','AI_PROCESSING','AI_ACTION_REQUIRED')",{updated:timestamp});
}

export async function markBillAiJobNotified(jobId,status) {
  await execute('UPDATE bill_ai_jobs SET last_notified_status=:status,updated_at=:updated WHERE job_id=:id',{id:clean(jobId,64),status:clean(status,32),updated:nowSql()});
}

export async function getPendingBillAiNotification() {
  const row=await one(`SELECT j.job_id FROM bill_ai_jobs j JOIN bills b ON b.bill_id=j.bill_id
    WHERE b.source='LINE' AND b.source_context_id<>'' AND j.status IN ('AI_RETRY','AI_ACTION_REQUIRED','AI_COMPLETED')
      AND j.last_notified_status<>j.status ORDER BY j.updated_at LIMIT 1`);
  if(!row)return null;
  const job=await getBillAiJob(row.job_id);
  return {job,bill:job.status==='AI_COMPLETED'?await getBillDetail(job.bill_id):null};
}

export async function getBillDetail(billId){const row=await one("SELECT b.*,p.project_name,co.company_name,c.category_name,j.job_id AS ai_job_id,j.status_message AS ai_status_message,j.next_attempt_at AS ai_next_attempt_at,j.attempts AS ai_attempts,COALESCE(NULLIF(lu.workhub_name, ''), NULLIF(b.source_user_name, ''), NULLIF(lu.display_name, ''), IF(b.source='LINE','ผู้ส่งผ่าน LINE','เว็บแอป')) AS owner_display_name FROM bills b LEFT JOIN projects p ON p.project_id=b.project_id LEFT JOIN companies co ON co.company_id=b.company_id LEFT JOIN categories c ON c.category_id=b.category_id LEFT JOIN line_users lu ON lu.user_id=b.source_user_id LEFT JOIN bill_ai_jobs j ON j.bill_id=b.bill_id WHERE b.bill_id=:id",{id:clean(billId,64)});if(!row)throw apiError('BILL_NOT_FOUND','ไม่พบบิล');const [items,documents]=await Promise.all([select('SELECT * FROM bill_items WHERE bill_id=:id ORDER BY line_no',{id:billId}),select('SELECT doc_id,bill_id,session_id,page_no,file_name,mime_type,sha256,size_bytes,original_size_bytes,compression,width,height,created_at FROM bill_documents WHERE bill_id=:id ORDER BY page_no',{id:billId})]);return{...enrichBill(row),items:items.map(publicRow),documents:documents.map(publicRow)};}

export async function getBillDocumentPreview(docId){const doc=await one('SELECT * FROM bill_documents WHERE doc_id=:id',{id:clean(docId,64)});if(!doc)throw apiError('DOCUMENT_NOT_FOUND','ไม่พบไฟล์เอกสาร');const buffer=await readBuffer(doc.file_path);if(buffer.length>8*1024*1024)throw apiError('PREVIEW_TOO_LARGE','ไฟล์ใหญ่เกินกว่าจะแสดงตัวอย่าง');return{fileName:doc.file_name,mimeType:doc.mime_type,dataUrl:`data:${doc.mime_type};base64,${buffer.toString('base64')}`,externalUrl:''};}

export async function repairAddressMatchFlags() {
  const rows = await select(`SELECT b.bill_id,b.buyer_name,b.buyer_tax_id,b.buyer_address,b.tax_id_match,b.company_match,b.address_match,b.document_date,b.vendor_name,b.needs_review,b.review_reasons,b.status,
      c.company_name,c.branch_name,c.tax_id AS company_tax_id,c.address AS company_address
    FROM bills b JOIN companies c ON c.company_id=b.company_id
    WHERE b.status NOT IN ('REJECTED','AI_QUEUED','AI_PROCESSING','AI_RETRY','AI_ACTION_REQUIRED')`);
  let repaired = 0;
  for (const row of rows) {
    const companyMatch = companyNamesMatch(row.company_name, row.buyer_name, row.branch_name, row.company_tax_id, row.buyer_tax_id);
    const taxMatch = !!taxId(row.company_tax_id) && taxId(row.company_tax_id) === taxId(row.buyer_tax_id);
    const addressMatch = addressesMatch(row.company_address, row.buyer_address);
    let reasons = [];
    try { reasons = Array.isArray(row.review_reasons) ? row.review_reasons : JSON.parse(row.review_reasons || '[]'); } catch (_) { reasons = clean(row.review_reasons, 2000).split(' | '); }
    reasons = reasons.map(reason => clean(reason, 180)).filter(reason => reason && !/(?:ชื่อบริษัท|เลขผู้เสียภาษี|ที่อยู่)ผู้ซื้อไม่ตรงกับบริษัทที่เลือก/.test(reason));
    if (!companyMatch) reasons.push('ชื่อบริษัทผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
    if (!taxMatch) reasons.push('เลขผู้เสียภาษีผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
    if (!addressMatch) reasons.push('ที่อยู่ผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
    reasons = [...new Set(reasons)];
    const needsReview = reasons.length > 0 || !companyMatch || !taxMatch || !addressMatch || !row.document_date || !clean(row.vendor_name);
    const status = needsReview ? 'NEEDS_REVIEW' : (row.status === 'NEEDS_REVIEW' ? 'PENDING_CONFIRMATION' : row.status);
    const changed = bool(row.company_match) !== companyMatch || bool(row.tax_id_match) !== taxMatch || bool(row.address_match) !== addressMatch
      || bool(row.needs_review) !== needsReview || row.status !== status;
    if (!changed) continue;
    await execute('UPDATE bills SET company_match=:companyMatch,tax_id_match=:taxMatch,address_match=:addressMatch,needs_review=:review,status=:status,review_reasons=:reasons,updated_at=:updated WHERE bill_id=:id', {
      id:row.bill_id, companyMatch:companyMatch?1:0, taxMatch:taxMatch?1:0, addressMatch:addressMatch?1:0,
      review:needsReview?1:0, status, reasons:JSON.stringify(reasons), updated:nowSql(),
    });
    repaired += 1;
  }
  return repaired;
}

export async function updateBill(payload={},actor='WEB'){const id=clean(payload.bill_id,64);const before=await one('SELECT * FROM bills WHERE bill_id=:id',{id});if(!before)throw apiError('BILL_NOT_FOUND','ไม่พบบิล');if(before.status==='REJECTED')throw apiError('BILL_REJECTED','กรุณากู้คืนบิลก่อนแก้ไข');const patch={};for(const field of BILL_FIELDS)if(Object.hasOwn(payload,field)){if(['subtotal','discount','vat_rate','vat_amount','withholding_tax','grand_total'].includes(field))patch[field]=number(payload[field]);else if(field==='document_date')patch[field]=normalizeCurrentYearBillDate(payload[field]);else if(field==='due_date')patch[field]=sqlDate(payload[field]);else if(['vendor_tax_id','buyer_tax_id'].includes(field))patch[field]=taxId(payload[field]);else patch[field]=clean(payload[field],['description','notes','vendor_address','buyer_address'].includes(field)?2000:255);}if(Object.hasOwn(payload,'source_user_id')){const ownerId=clean(payload.source_user_id,160);const owner=await billOwner(ownerId);if(!owner)throw apiError('BILL_OWNER_REQUIRED','กรุณาเลือกเจ้าของบิลจากรายชื่อผู้ที่เคยส่งบิลผ่าน LINE');patch.source_user_id=owner.user_id;patch.source_user_name=clean(owner.owner_name,255)||'ผู้ส่งผ่าน LINE';}if(!patch.project_id&&!before.project_id||!patch.company_id&&!before.company_id)throw apiError('REQUIRED_FIELDS','กรุณาเลือกโครงการและบริษัท');const company=await one('SELECT * FROM companies WHERE company_id=:id',{id:patch.company_id||before.company_id});const effective={...before,...patch};patch.tax_id_match=company&&taxId(company.tax_id)===taxId(effective.buyer_tax_id)?1:0;patch.company_match=company&&companyNamesMatch(company.company_name,effective.buyer_name,company.branch_name,company.tax_id,effective.buyer_tax_id)?1:0;patch.address_match=company&&addressesMatch(company.address,effective.buyer_address)?1:0;patch.needs_review=!patch.company_match||!patch.tax_id_match||!patch.address_match||!effective.document_date||!effective.vendor_name?1:0;patch.status=patch.needs_review?'NEEDS_REVIEW':'PENDING_CONFIRMATION';patch.updated_at=nowSql();const columns=Object.keys(patch);await execute(`UPDATE bills SET ${columns.map(key=>`${key}=:${key}`).join(',')} WHERE bill_id=:bill_id`,{...patch,bill_id:id});await execute('INSERT INTO audit_logs (log_id,entity_type,entity_id,action,actor,before_json,after_json,created_at) VALUES (:log,\'bill\',:id,\'UPDATE\',:actor,:before,:after,:created)',{log:uuid(),id,actor,before:JSON.stringify(publicRow(before)),after:JSON.stringify(patch),created:nowSql()});return getBillDetail(id);}

async function setBillStatus(id,status,actor){const before=await one('SELECT * FROM bills WHERE bill_id=:id',{id:clean(id,64)});if(!before)throw apiError('BILL_NOT_FOUND','ไม่พบบิล');const timestamp=nowSql();const patch=status==='CONFIRMED'?{status,needs_review:0,confirmed_at:timestamp,updated_at:timestamp}:status==='REJECTED'?{status,needs_review:0,confirmed_at:before.confirmed_at||null,updated_at:timestamp}:{status:'NEEDS_REVIEW',needs_review:1,confirmed_at:null,updated_at:timestamp};await execute('UPDATE bills SET status=:status,needs_review=:needs_review,confirmed_at=:confirmed_at,updated_at=:updated_at WHERE bill_id=:id',{...patch,id});if(status==='REJECTED')await execute("UPDATE bill_ai_jobs SET status='AI_CANCELLED',status_message='ผู้ใช้ยกเลิกรายการนี้แล้ว',next_attempt_at=NULL,updated_at=:updated WHERE bill_id=:id AND status<>'AI_COMPLETED'",{id,updated:timestamp});await execute('INSERT INTO audit_logs (log_id,entity_type,entity_id,action,actor,before_json,after_json,created_at) VALUES (:log,\'bill\',:id,:action,:actor,:before,:after,:created)',{log:uuid(),id,action:status,actor:clean(actor||'WEB',160),before:JSON.stringify(publicRow(before)),after:JSON.stringify(patch),created:timestamp});return getBillDetail(id);}
export const confirmBill=(id,actor)=>setBillStatus(id,'CONFIRMED',actor);
export const deleteBill=(id,actor)=>setBillStatus(id,'REJECTED',actor);
export const restoreBill=(id,actor)=>setBillStatus(id,'NEEDS_REVIEW',actor);

function thaiLongDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return'-';const[y,m,d]=String(value).split('-').map(Number),date=new Date(Date.UTC(y,m-1,d)),days=['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์'],months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];return`${days[date.getUTCDay()]} ที่ ${d} ${months[m-1]} ${y+543}`;}

async function billsForExport(input={}){
  const selection=typeof input==='string'?{month:input}:(input&&typeof input==='object'?input:{}),params={},where=[];
  if(selection.status){where.push('b.status=:status');params.status=clean(selection.status,32);}else where.push("b.status NOT IN ('REJECTED','AI_QUEUED','AI_PROCESSING','AI_RETRY','AI_ACTION_REQUIRED')");
  if(selection.project_id){where.push('b.project_id=:project');params.project=clean(selection.project_id,64);}
  if(selection.company_id){where.push('b.company_id=:company');params.company=clean(selection.company_id,64);}
  if(selection.category_id){where.push('b.category_id=:category');params.category=clean(selection.category_id,64);}
  if(selection.date_from){where.push('COALESCE(b.document_date,DATE(b.created_at))>=:dateFrom');params.dateFrom=sqlDate(selection.date_from);}
  if(selection.date_to){where.push('COALESCE(b.document_date,DATE(b.created_at))<=:dateTo');params.dateTo=sqlDate(selection.date_to);}
  if(Array.isArray(selection.owner_ids)){
    const ownerIds=[...new Set(selection.owner_ids.map(value=>clean(value,160)).filter(Boolean))].slice(0,200);
    if(!ownerIds.length)where.push('1=0');
    else{const placeholders=ownerIds.map((value,index)=>{params[`owner${index}`]=value;return`:owner${index}`;});where.push(`b.source_user_id IN (${placeholders.join(',')})`);}
  }
  if(Array.isArray(selection.owner_names)&&!Array.isArray(selection.owner_ids)){
    const names=[...new Set(selection.owner_names.map(value=>clean(value,255)).filter(Boolean))].slice(0,100);
    if(!names.length)where.push('1=0');
    else{const placeholders=names.map((value,index)=>{params[`ownerName${index}`]=value;return`:ownerName${index}`;});where.push(`COALESCE(NULLIF(lu.workhub_name,''),NULLIF(b.source_user_name,''),NULLIF(lu.display_name,'')) IN (${placeholders.join(',')})`);}
  }
  if(selection.query){where.push("LOWER(CONCAT_WS(' ',b.vendor_name,b.vendor_tax_id,b.buyer_name,b.description,b.notes,b.source_user_name,lu.display_name,lu.workhub_name,p.project_name,co.company_name,c.category_name)) LIKE :query");params.query=`%${clean(selection.query,180).toLowerCase()}%`;}
  if(selection.month){where.push("DATE_FORMAT(COALESCE(b.document_date,b.created_at),'%Y-%m')=:month");params.month=normalizePeriod(selection.month);}
  const rows=await select(`SELECT b.*,p.project_name,co.company_name,c.category_name,COALESCE(NULLIF(lu.workhub_name,''),NULLIF(b.source_user_name,''),NULLIF(lu.display_name,''),IF(b.source='LINE','ผู้ส่งผ่าน LINE','เว็บแอป')) AS owner_name,items.item_descriptions FROM bills b LEFT JOIN projects p ON p.project_id=b.project_id LEFT JOIN companies co ON co.company_id=b.company_id LEFT JOIN categories c ON c.category_id=b.category_id LEFT JOIN line_users lu ON lu.user_id=b.source_user_id LEFT JOIN (SELECT bill_id,GROUP_CONCAT(NULLIF(description,'') ORDER BY line_no SEPARATOR ', ') AS item_descriptions FROM bill_items GROUP BY bill_id) items ON items.bill_id=b.bill_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(b.document_date,DATE(b.created_at)),b.created_at`,params);
  if(rows.length>5000)throw apiError('EXPORT_LIMIT','Export ได้สูงสุด 5,000 บิลต่อครั้ง กรุณาเพิ่มตัวกรอง');
  return rows.map(row=>({...enrichBill(row),document_date_thai:thaiLongDate(row.document_date)}));
}

function exportName(selection,extension){const period=typeof selection==='string'?normalizePeriod(selection):(selection?.month?normalizePeriod(selection.month):new Date().toISOString().slice(0,10));return`สรุปบิล_${period}.${extension}`;}

export async function exportMonthlyBillExcel(selection,createTicket){const rows=await billsForExport(selection);const buffer=await createBillXlsx(rows);return createTicket(buffer,exportName(selection,'xlsx'),XLSX_MIME,rows.length);}
export async function exportMonthlyBillWord(selection,createTicket){const rows=await billsForExport(selection);if(rows.length>300)throw apiError('EXPORT_LIMIT','DOCX ส่งออกได้สูงสุด 300 บิลต่อครั้ง กรุณาเพิ่มตัวกรอง');for(const row of rows){const documents=await select('SELECT file_path,file_name FROM bill_documents WHERE bill_id=:id ORDER BY page_no',{id:row.bill_id});row.documents=[];for(const document of documents)row.documents.push({name:document.file_name,buffer:await readBuffer(document.file_path)});}const buffer=await createSimpleBillDocx('',rows);return createTicket(buffer,exportName(selection,'docx'),DOCX_MIME,rows.length);}
