import { config } from '../config.mjs';
import { execute, one, select, transaction } from '../db.mjs';
import { readBuffer, removeFile, storeBuffer, storeCompressedImage } from '../files.mjs';
import { createSimpleBillDocx, createXlsx, DOCX_MIME, XLSX_MIME } from '../exports.mjs';
import { apiError, bool, clean, normalizeDate, normalizePeriod, nowSql, number, publicRow, token, uuid } from '../utils.mjs';
import { enrichBill } from './masters.mjs';

const BILL_FIELDS = ['project_id','company_id','category_id','doc_type','document_no','document_date','due_date','vendor_name','vendor_tax_id','vendor_branch','vendor_address','buyer_name','buyer_tax_id','buyer_address','currency','subtotal','discount','vat_rate','vat_amount','withholding_tax','grand_total','payment_method','description','notes'];

const thaiNormalize = value => clean(value, 1000).toLowerCase().replace(/[\s.,()\-_/]/g, '').replace(/กรุงเทพมหานคร/g, 'กรุงเทพ');
const taxId = value => clean(value, 30).replace(/\D/g, '').slice(0, 13);
const sqlDate = value => normalizeDate(value);

async function analyzeWithGemini(images, context) {
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
    `วันที่รับเข้า ${context.receivedDate} ใช้อ้างอิงเท่านั้น วันที่เอกสารต้องเป็น YYYY-MM-DD ค.ศ. ถ้าอ่านไม่ครบให้ค่าว่าง ห้ามเดา`,
    'ตรวจบริษัทผู้ซื้อโดยเน้นเลขผู้เสียภาษี 13 หลักก่อนชื่อและที่อยู่ ช่องอ่านไม่ได้ใช้ค่าว่างหรือ 0',
    'ถ้าภาพไม่ชัดหรือข้อมูลสำคัญไม่ครบ ให้ needs_review=true และเขียนเหตุผลภาษาไทย',
    `บริษัท: ${JSON.stringify(context.companies.map(item=>({id:item.company_id,name:item.company_name,branch:item.branch_name,tax_id:item.tax_id,address:item.address})))}`,
    `หมวดหมู่: ${JSON.stringify(context.categories.map(item=>({id:item.category_id,name:item.category_name,aliases:item.aliases})))}`,
  ].join('\n');
  const started = Date.now();
  let responseBody = {};
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`, {
      method:'POST', headers:{'content-type':'application/json','x-goog-api-key':config.geminiApiKey},
      body:JSON.stringify({ systemInstruction:{parts:[{text:'You are a precise Thai accounting-document extraction engine. Return only schema-valid JSON. Never invent unreadable values.'}]}, contents:[{role:'user',parts:[{text:prompt},...images.map(image=>({inlineData:{mimeType:'image/jpeg',data:image.buffer.toString('base64')}}))]}], generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:4096,thinkingConfig:{thinkingLevel:'minimal'}} }),
      signal:AbortSignal.timeout(300000),
    });
    responseBody = await response.json();
    if (!response.ok) throw new Error(clean(responseBody?.error?.message || `Gemini HTTP ${response.status}`, 500));
    const output = (responseBody.candidates?.[0]?.content?.parts || []).filter(part=>!part.thought && part.text).map(part=>part.text).join('');
    if (!output) throw new Error('Gemini ไม่ส่งข้อมูลกลับมา');
    const result = JSON.parse(output);
    const allowedCompanies = new Set(context.companies.map(item=>String(item.company_id)));
    const allowedCategories = new Set(context.categories.map(item=>String(item.category_id)));
    result.company_id = allowedCompanies.has(String(result.company_id)) ? String(result.company_id) : '';
    result.category_id = allowedCategories.has(String(result.category_id)) ? String(result.category_id) : '';
    const extractedDate = sqlDate(result.document_date);
    result.document_date = extractedDate || context.receivedDate;
    result.due_date = sqlDate(result.due_date);
    result.vendor_tax_id = taxId(result.vendor_tax_id);
    result.buyer_tax_id = taxId(result.buyer_tax_id);
    result.review_reasons = Array.isArray(result.review_reasons) ? result.review_reasons.map(value=>clean(value,180)).filter(Boolean) : [];
    if (!extractedDate) result.review_reasons.push(`ไม่พบวันที่เอกสารชัดเจน ระบบใช้วันที่รับเข้า ${context.receivedDate} ชั่วคราว`);
    result.quality_score = Math.max(0, Math.min(100, number(result.quality_score)));
    result.needs_review = bool(result.needs_review) || !extractedDate || result.quality_score < 70 || !clean(result.vendor_name);
    result.items = Array.isArray(result.items) ? result.items.slice(0,200) : [];
    await execute('INSERT INTO ai_usage (usage_id,bill_id,model,prompt_version,input_tokens,output_tokens,thought_tokens,total_tokens,latency_ms,success,error,created_at) VALUES (:id,:bill,:model,:prompt,:input,:output,:thought,:total,:latency,1,\'\',:created)', { id:uuid(), bill:context.billId, model:config.geminiModel, prompt:'bill-th-nas-v1', input:number(responseBody.usageMetadata?.promptTokenCount), output:number(responseBody.usageMetadata?.candidatesTokenCount), thought:number(responseBody.usageMetadata?.thoughtsTokenCount), total:number(responseBody.usageMetadata?.totalTokenCount), latency:Date.now()-started, created:nowSql() });
    return result;
  } catch (error) {
    await execute('INSERT INTO ai_usage (usage_id,bill_id,model,prompt_version,input_tokens,output_tokens,thought_tokens,total_tokens,latency_ms,success,error,created_at) VALUES (:id,:bill,:model,:prompt,0,0,0,0,:latency,0,:error,:created)', { id:uuid(), bill:context.billId, model:config.geminiModel, prompt:'bill-th-nas-v1', latency:Date.now()-started, error:clean(error.message,500), created:nowSql() });
    throw apiError('GEMINI_ERROR', `Gemini วิเคราะห์ไม่สำเร็จ: ${clean(error.message,400)}`, 502);
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

export async function submitBillPages(payload = {}) {
  const projectId=clean(payload.project_id,64); const companyId=clean(payload.company_id,64);
  const files=Array.isArray(payload.files)?payload.files:[];
  const expected=Math.max(1,Math.min(config.maxPagesPerBill,Number(payload.expected_pages)||files.length||1));
  if (!projectId || !companyId) throw apiError('REQUIRED_FIELDS','กรุณาเลือกโครงการและบริษัท');
  if (!files.length || files.length!==expected || files.length>config.maxPagesPerBill) throw apiError('INVALID_PAGE_COUNT',`กรุณาเลือก 1-${config.maxPagesPerBill} รูป และจำนวนหน้าต้องตรงกัน`);
  const [project,company,categories,companies]=await Promise.all([one('SELECT * FROM projects WHERE project_id=:id AND active=1',{id:projectId}),one('SELECT * FROM companies WHERE company_id=:id AND active=1',{id:companyId}),select('SELECT * FROM categories WHERE active=1'),select('SELECT * FROM companies WHERE active=1')]);
  if(!project||!company) throw apiError('MASTER_NOT_FOUND','ไม่พบโครงการหรือบริษัทที่เลือก');
  const billId=uuid(); const sessionId=uuid(); const stored=[];
  try {
    for(let index=0;index<files.length;index+=1){const file=files[index]||{}; stored.push(await storeCompressedImage('uploads',clean(file.name||file.fileName,180)||`bill-page-${index+1}.jpg`,file.dataUrl||file.data_url,{maxLongEdge:1800,quality:80}));}
    const receivedDate=new Date().toISOString().slice(0,10);
    // Read only after compression so Gemini and saved document use the exact same bytes.
    const images=await Promise.all(stored.map(async item=>({buffer:await readBuffer(item.relative)})));
    const analysis=await analyzeWithGemini(images,{companies,categories,billId,receivedDate});
    const targetTax=taxId(company.tax_id); const buyerTax=taxId(analysis.buyer_tax_id);
    const taxMatch=!!targetTax&&targetTax===buyerTax;
    const companyMatch=String(analysis.company_id)===String(companyId)||thaiNormalize(analysis.buyer_name)===thaiNormalize(company.company_name);
    const addressMatch=!!thaiNormalize(analysis.buyer_address)&&thaiNormalize(company.address).includes(thaiNormalize(analysis.buyer_address).slice(0,20));
    const duplicateKey=[taxId(analysis.vendor_tax_id)||thaiNormalize(analysis.vendor_name),clean(analysis.document_no,160),analysis.document_date,number(analysis.grand_total).toFixed(2)].join('|');
    const duplicate=await one("SELECT bill_id FROM bills WHERE duplicate_key=:key AND status<>'REJECTED' LIMIT 1",{key:duplicateKey});
    const reasons=[...(analysis.review_reasons||[])];
    if(duplicate) reasons.push(`อาจเป็นบิลซ้ำกับเลขที่ ${duplicate.bill_id}`);
    if(!taxMatch) reasons.push('เลขผู้เสียภาษีผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
    if(!addressMatch) reasons.push('ที่อยู่ผู้ซื้อไม่ตรงกับบริษัทที่เลือก');
    const needsReview=bool(analysis.needs_review)||!!duplicate||!taxMatch||!addressMatch;
    const timestamp=nowSql();
    await transaction(async connection=>{
      const vendorId=await getVendor(connection,analysis,timestamp);
      await connection.execute('INSERT INTO upload_sessions (session_id,project_id,company_id,expected_pages,received_pages,status,source,source_user_id,source_context_id,created_at,expires_at,updated_at) VALUES (?,?,?,?,?,\'READY\',?,?,?,?,DATE_ADD(?,INTERVAL 24 HOUR),?)',[sessionId,projectId,companyId,expected,files.length,clean(payload.source||'WEB',32),clean(payload.source_user_id,160),clean(payload.source_context_id,160),timestamp,timestamp,timestamp]);
      const values={ bill_id:billId,session_id:sessionId,project_id:projectId,company_id:companyId,category_id:clean(analysis.category_id,64),doc_type:clean(analysis.doc_type||'OTHER',80),document_no:clean(analysis.document_no,160),document_date:analysis.document_date,due_date:analysis.due_date,vendor_id:vendorId,vendor_name:clean(analysis.vendor_name,255),vendor_tax_id:taxId(analysis.vendor_tax_id),vendor_branch:clean(analysis.vendor_branch,160),vendor_address:clean(analysis.vendor_address,1000),buyer_name:clean(analysis.buyer_name,255),buyer_tax_id:buyerTax,buyer_address:clean(analysis.buyer_address,1000),currency:clean(analysis.currency||'THB',12),subtotal:number(analysis.subtotal),discount:number(analysis.discount),vat_rate:number(analysis.vat_rate),vat_amount:number(analysis.vat_amount),withholding_tax:number(analysis.withholding_tax),grand_total:number(analysis.grand_total),payment_method:clean(analysis.payment_method,120),description:clean(analysis.description,2000),notes:clean(analysis.notes,2000),page_count:expected,image_quality:clean(analysis.image_quality,40),quality_score:number(analysis.quality_score),needs_review:needsReview?1:0,review_reasons:JSON.stringify([...new Set(reasons)]),company_match:companyMatch?1:0,tax_id_match:taxMatch?1:0,address_match:addressMatch?1:0,duplicate_key:duplicateKey,status:needsReview?'NEEDS_REVIEW':'PENDING_CONFIRMATION',source:clean(payload.source||'WEB',32),source_user_id:clean(payload.source_user_id,160),source_context_id:clean(payload.source_context_id,160),folder_path:stored[0].relative.split('/').slice(0,-1).join('/'),created_at:timestamp,updated_at:timestamp };
      const columns=Object.keys(values); await connection.execute(`INSERT INTO bills (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,Object.values(values));
      for(let index=0;index<(analysis.items||[]).length;index+=1){const item=analysis.items[index];await connection.execute('INSERT INTO bill_items (item_id,bill_id,line_no,description,quantity,unit,unit_price,discount,vat_amount,amount,sku) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[uuid(),billId,index+1,clean(item.description,1000),number(item.quantity),clean(item.unit,80),number(item.unit_price),number(item.discount),number(item.vat_amount),number(item.amount),clean(item.sku,120)]);}
      for(let index=0;index<stored.length;index+=1){const item=stored[index];await connection.execute('INSERT INTO bill_documents (doc_id,bill_id,session_id,page_no,file_path,file_name,mime_type,sha256,size_bytes,original_size_bytes,compression,width,height,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[uuid(),billId,sessionId,index+1,item.relative,item.relative.split('/').pop(),item.mime,item.sha256,item.size,item.originalSize,item.compression,item.width,item.height,timestamp]);}
      await connection.execute('INSERT INTO audit_logs (log_id,entity_type,entity_id,action,actor,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)',[uuid(),'bill',billId,'AI_EXTRACT',clean(payload.source_user_id||'WEB',160),null,JSON.stringify(values),timestamp]);
    });
    return getBillDetail(billId);
  }catch(error){await Promise.all(stored.map(item=>removeFile(item.relative)));throw error;}
}

export async function getBillDetail(billId){const row=await one('SELECT b.*,p.project_name,co.company_name,c.category_name FROM bills b LEFT JOIN projects p ON p.project_id=b.project_id LEFT JOIN companies co ON co.company_id=b.company_id LEFT JOIN categories c ON c.category_id=b.category_id WHERE b.bill_id=:id',{id:clean(billId,64)});if(!row)throw apiError('BILL_NOT_FOUND','ไม่พบบิล');const [items,documents]=await Promise.all([select('SELECT * FROM bill_items WHERE bill_id=:id ORDER BY line_no',{id:billId}),select('SELECT doc_id,bill_id,session_id,page_no,file_name,mime_type,sha256,size_bytes,original_size_bytes,compression,width,height,created_at FROM bill_documents WHERE bill_id=:id ORDER BY page_no',{id:billId})]);return{...enrichBill(row),items:items.map(publicRow),documents:documents.map(publicRow)};}

export async function getBillDocumentPreview(docId){const doc=await one('SELECT * FROM bill_documents WHERE doc_id=:id',{id:clean(docId,64)});if(!doc)throw apiError('DOCUMENT_NOT_FOUND','ไม่พบไฟล์เอกสาร');const buffer=await readBuffer(doc.file_path);if(buffer.length>8*1024*1024)throw apiError('PREVIEW_TOO_LARGE','ไฟล์ใหญ่เกินกว่าจะแสดงตัวอย่าง');return{fileName:doc.file_name,mimeType:doc.mime_type,dataUrl:`data:${doc.mime_type};base64,${buffer.toString('base64')}`,externalUrl:''};}

export async function updateBill(payload={},actor='WEB'){const id=clean(payload.bill_id,64);const before=await one('SELECT * FROM bills WHERE bill_id=:id',{id});if(!before)throw apiError('BILL_NOT_FOUND','ไม่พบบิล');if(before.status==='REJECTED')throw apiError('BILL_REJECTED','กรุณากู้คืนบิลก่อนแก้ไข');const patch={};for(const field of BILL_FIELDS)if(Object.hasOwn(payload,field)){if(['subtotal','discount','vat_rate','vat_amount','withholding_tax','grand_total'].includes(field))patch[field]=number(payload[field]);else if(['document_date','due_date'].includes(field))patch[field]=sqlDate(payload[field]);else if(['vendor_tax_id','buyer_tax_id'].includes(field))patch[field]=taxId(payload[field]);else patch[field]=clean(payload[field],['description','notes','vendor_address','buyer_address'].includes(field)?2000:255);}if(!patch.project_id&&!before.project_id||!patch.company_id&&!before.company_id)throw apiError('REQUIRED_FIELDS','กรุณาเลือกโครงการและบริษัท');const company=await one('SELECT * FROM companies WHERE company_id=:id',{id:patch.company_id||before.company_id});const effective={...before,...patch};patch.tax_id_match=company&&taxId(company.tax_id)===taxId(effective.buyer_tax_id)?1:0;patch.company_match=company&&thaiNormalize(company.company_name)===thaiNormalize(effective.buyer_name)?1:0;patch.address_match=company&&thaiNormalize(company.address).includes(thaiNormalize(effective.buyer_address).slice(0,20))?1:0;patch.needs_review=!patch.tax_id_match||!patch.address_match||!effective.document_date||!effective.vendor_name?1:0;patch.status=patch.needs_review?'NEEDS_REVIEW':'PENDING_CONFIRMATION';patch.updated_at=nowSql();const columns=Object.keys(patch);await execute(`UPDATE bills SET ${columns.map(key=>`${key}=:${key}`).join(',')} WHERE bill_id=:bill_id`,{...patch,bill_id:id});await execute('INSERT INTO audit_logs (log_id,entity_type,entity_id,action,actor,before_json,after_json,created_at) VALUES (:log,\'bill\',:id,\'UPDATE\',:actor,:before,:after,:created)',{log:uuid(),id,actor,before:JSON.stringify(publicRow(before)),after:JSON.stringify(patch),created:nowSql()});return getBillDetail(id);}

async function setBillStatus(id,status,actor){const before=await one('SELECT * FROM bills WHERE bill_id=:id',{id:clean(id,64)});if(!before)throw apiError('BILL_NOT_FOUND','ไม่พบบิล');const timestamp=nowSql();const patch=status==='CONFIRMED'?{status,needs_review:0,confirmed_at:timestamp,updated_at:timestamp}:status==='REJECTED'?{status,needs_review:0,confirmed_at:before.confirmed_at||null,updated_at:timestamp}:{status:'NEEDS_REVIEW',needs_review:1,confirmed_at:null,updated_at:timestamp};await execute('UPDATE bills SET status=:status,needs_review=:needs_review,confirmed_at=:confirmed_at,updated_at=:updated_at WHERE bill_id=:id',{...patch,id});await execute('INSERT INTO audit_logs (log_id,entity_type,entity_id,action,actor,before_json,after_json,created_at) VALUES (:log,\'bill\',:id,:action,:actor,:before,:after,:created)',{log:uuid(),id,action:status,actor:clean(actor||'WEB',160),before:JSON.stringify(publicRow(before)),after:JSON.stringify(patch),created:timestamp});return getBillDetail(id);}
export const confirmBill=(id,actor)=>setBillStatus(id,'CONFIRMED',actor);
export const deleteBill=(id,actor)=>setBillStatus(id,'REJECTED',actor);
export const restoreBill=(id,actor)=>setBillStatus(id,'NEEDS_REVIEW',actor);

async function monthlyBills(period){const month=normalizePeriod(period);const rows=await select("SELECT b.*,p.project_name,co.company_name,c.category_name FROM bills b LEFT JOIN projects p ON p.project_id=b.project_id LEFT JOIN companies co ON co.company_id=b.company_id LEFT JOIN categories c ON c.category_id=b.category_id WHERE b.status<>'REJECTED' AND DATE_FORMAT(COALESCE(b.document_date,b.created_at),'%Y-%m')=:month ORDER BY b.document_date,b.created_at",{month});return{month,rows:rows.map(enrichBill)};}

export async function exportMonthlyBillExcel(period,createTicket){const{month,rows}=await monthlyBills(period);const headers=['ลำดับ','วันที่เอกสาร','ผู้ขาย','เจ้าของบิล/ผู้ส่ง','รายการของ','โครงการ','บริษัท','หมวดหมู่','ยอดก่อนภาษี','VAT','หัก ณ ที่จ่าย','ยอดสุทธิ'];const values=rows.map((row,index)=>[index+1,row.document_date||'',row.vendor_name||'',row.source_user_id||'เว็บแอป',row.description||'',row.project_name||'',row.company_name||'',row.category_name||'',number(row.subtotal),number(row.vat_amount),number(row.withholding_tax),number(row.grand_total)]);const total=rows.reduce((sum,row)=>sum+number(row.grand_total),0);values.push(['','','','','','','','รวมทั้งหมด','','',total]);const buffer=await createXlsx('รายการบิล',headers,values,[8,14,30,24,32,28,32,24,16,14,16,16]);return createTicket(buffer,`สรุปบิล_${month}.xlsx`,XLSX_MIME,rows.length);}
export async function exportMonthlyBillWord(period,createTicket){const{month,rows}=await monthlyBills(period);const buffer=await createSimpleBillDocx(`สรุปรายการบิล ${month}`,rows);return createTicket(buffer,`สรุปบิล_${month}.docx`,DOCX_MIME,rows.length);}

export async function backfillLineUsernames(){return{updated:0,skipped:true,message:'ระบบ LINE ถูกพักไว้ในเฟส NAS Web App และข้อมูลเดิมยังคงอยู่'};}
