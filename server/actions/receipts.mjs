import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.mjs';
import { execute, one, select, transaction } from '../db.mjs';
import { parseDataUrl, readBuffer, removeFile, safeName, storeBuffer, storeCompressedImage } from '../files.mjs';
import { createReceiptDocx, createXlsx, DOCX_MIME, inspectTemplate, XLSX_MIME } from '../exports.mjs';
import { apiError, bool, clean, maskNationalId, normalizeNationalId, nowSql, number, publicRow, uuid } from '../utils.mjs';

const run = promisify(execFile);

function splitName(value) {
  const parts = clean(value, 255).replace(/^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง)\s*/, '').replace(/\s+/g, ' ').split(' ').filter(Boolean);
  return { fullName: parts.join(' '), firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

function validNationalId(value) {
  const id = normalizeNationalId(value);
  if (id.length !== 13) return false;
  const sum = [...id.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (13 - index), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export function normalizeReceiptAiResult(input = {}) {
  const names = splitName(input.full_name);
  const national = normalizeNationalId(input.national_id);
  const address = clean(input.address, 1000).replace(/\s+/g, ' ');
  const rawConfidence = number(input.confidence);
  const confidence = Math.max(0, Math.min(100, rawConfidence > 0 && rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence));
  const warnings = (Array.isArray(input.warnings) ? input.warnings : []).map(item => clean(item, 180)).filter(Boolean);
  if (national && !validNationalId(national)) warnings.push('เลขบัตรไม่ผ่าน checksum กรุณาตรวจสอบ');
  if (!names.fullName || !national || !address) warnings.push('AI อ่านข้อมูลไม่ครบ กรุณาตรวจสอบและแก้ไขก่อนบันทึก');
  return { ...names, national, address, confidence, warnings:[...new Set(warnings)] };
}

export function buildReceiptAiRequest(cards = []) {
  const schema = {
    type:'array',
    items:{
      type:'object', additionalProperties:false,
      properties:{ image_index:{type:'integer'}, full_name:{type:'string'}, national_id:{type:'string'}, address:{type:'string'}, confidence:{type:'number'}, warnings:{type:'array',items:{type:'string'}} },
      required:['image_index','full_name','national_id','address','confidence','warnings'],
    },
  };
  const prompt = [
    `อ่านบัตรประจำตัวประชาชนไทย ${cards.length} รูป แต่ละรูปคือคนละหนึ่งคน`,
    'คืนข้อมูลหนึ่งรายการต่อหนึ่งรูปตาม image_index ห้ามสลับคนหรือรวมข้อมูลข้ามรูป',
    'full_name ใช้ชื่อและนามสกุลภาษาไทยตามที่มองเห็น โดยไม่ใส่คำนำหน้า นาย/นาง/นางสาว',
    'national_id ใช้ตัวเลข 13 หลักเท่านั้น ไม่ใส่เว้นวรรคหรือขีด',
    'address อ่านที่อยู่ภาษาไทยให้ครบตั้งแต่เลขที่ หมู่ ซอย ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด ตามที่มองเห็น',
    'confidence เป็นคะแนน 0-100 ถ้าไม่แน่ใจให้เว้นค่าว่างและเขียนคำเตือนภาษาไทย ห้ามเดาข้อมูลที่อ่านไม่ชัด',
  ].join('\n');
  const parts = [{ text:prompt }];
  cards.forEach((card,index) => {
    parts.push({ text:`IMAGE_INDEX=${index + 1}` });
    parts.push({ inlineData:{ mimeType:'image/jpeg', data:card.buffer.toString('base64') } });
  });
  return {
    systemInstruction:{parts:[{text:'You are a precise Thai national-ID extraction engine. Read only visible text and return schema-valid JSON.'}]},
    contents:[{role:'user',parts}],
    generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:Math.min(4096,768+cards.length*384),temperature:0,thinkingConfig:{thinkingLevel:'minimal'}},
  };
}

async function analyzeReceiptCards(cards, batchId, model = config.receiptGeminiModel) {
  if (!config.receiptGeminiApiKey) throw apiError('RECEIPT_AI_NOT_CONFIGURED','ยังไม่ได้ตั้งค่า Gemini API สำหรับเอกสารใบรับเงิน',503);
  const started = Date.now(); let responseBody = {};
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method:'POST', headers:{'content-type':'application/json','x-goog-api-key':config.receiptGeminiApiKey}, body:JSON.stringify(buildReceiptAiRequest(cards)), signal:AbortSignal.timeout(180000),
    });
    responseBody = await response.json();
    if (!response.ok) { const error=new Error(clean(responseBody?.error?.message||`Gemini HTTP ${response.status}`,500)); error.httpStatus=response.status; error.retryAfterSeconds=Math.max(10,Math.min(300,number(response.headers.get('retry-after'))||30)); throw error; }
    const output=(responseBody.candidates?.[0]?.content?.parts||[]).filter(part=>!part.thought&&part.text).map(part=>part.text).join('');
    if(!output)throw new Error('Gemini ไม่ส่งข้อมูลกลับมา');
    const parsed=JSON.parse(output);if(!Array.isArray(parsed))throw new Error('Gemini ส่งรูปแบบข้อมูลไม่ถูกต้อง');
    await execute('INSERT INTO ai_usage (usage_id,bill_id,model,prompt_version,input_tokens,output_tokens,thought_tokens,total_tokens,latency_ms,success,error,created_at) VALUES (:id,:bill,:model,:prompt,:input,:output,:thought,:total,:latency,1,\'\',:created)',{id:uuid(),bill:`receipt:${batchId}`,model,prompt:'thai-id-batch-v2',input:number(responseBody.usageMetadata?.promptTokenCount),output:number(responseBody.usageMetadata?.candidatesTokenCount),thought:number(responseBody.usageMetadata?.thoughtsTokenCount),total:number(responseBody.usageMetadata?.totalTokenCount),latency:Date.now()-started,created:nowSql()});
    return parsed;
  } catch(error) {
    await execute('INSERT INTO ai_usage (usage_id,bill_id,model,prompt_version,input_tokens,output_tokens,thought_tokens,total_tokens,latency_ms,success,error,created_at) VALUES (:id,:bill,:model,:prompt,0,0,0,0,:latency,0,:error,:created)',{id:uuid(),bill:`receipt:${batchId}`,model,prompt:'thai-id-batch-v2',latency:Date.now()-started,error:clean(error.message,500),created:nowSql()});
    throw error;
  }
}

async function reportSites() {
  const row=await one("SELECT state_json FROM workhub_module_state WHERE module_key='reports'");
  if(!row?.state_json)return [];
  try {
    const data=JSON.parse(row.state_json),groups=new Map((data.groups||[]).map(group=>[String(group.id),group]));
    return (data.sites||[]).map(site=>({
      report_site_id:clean(site.uid||site.id,80),site_id:clean(site.id,80),site_code:clean(site.siteCode||site.site_code||site.id,120),
      site_name:clean(site.name,255),province:clean(site.province,160),group_name:clean(groups.get(String(site.groupId))?.name,255),
    })).filter(site=>site.report_site_id&&site.site_id);
  } catch { return []; }
}

async function groupsWithProjects() {
  return (await select("SELECT g.*, COALESCE(NULLIF(g.site_code,''),p.project_code,'') AS resolved_site_code, COALESCE(p.project_name,'') AS project_site_name FROM labor_groups g LEFT JOIN projects p ON p.project_id=g.project_id WHERE g.active=1 ORDER BY g.group_name")).map(row=>publicRow({...row,site_name:row.project_site_name||row.group_name}));
}

function registrationForClient(row, includeSensitive = false) {
  const result = publicRow(row);
  result.ocr_warnings = Array.isArray(result.ocr_warnings) ? result.ocr_warnings.join(' | ') : clean(result.ocr_warnings, 1500);
  result.national_id_masked = maskNationalId(result.national_id);
  if (!includeSensitive) delete result.card_path;
  return result;
}

async function receiptBatchSnapshot(batchId) {
  const batch=await one('SELECT * FROM receipt_batches WHERE batch_id=:id',{id:clean(batchId,64)});
  if(!batch)return null;
  const rows=await select('SELECT * FROM receipt_registrations WHERE batch_id=:id ORDER BY created_at,registration_id',{id:batch.batch_id});
  const counts={uploaded:rows.length,ready:0,queued:0,retry:0,processing:0,failed:0};
  rows.forEach(row=>{if(row.status==='OCR_READY')counts.ready+=1;else if(row.status==='AI_QUEUED')counts.queued+=1;else if(row.status==='AI_RETRY')counts.retry+=1;else if(row.status==='AI_PROCESSING')counts.processing+=1;else if(row.status==='AI_FAILED')counts.failed+=1;});
  return{batch:publicRow(batch),rows:rows.map(row=>registrationForClient(row)),counts,pending:counts.queued+counts.retry+counts.processing};
}

async function latestActiveReceiptBatch() {
  const batch=await one(`SELECT b.* FROM receipt_batches b WHERE b.status NOT IN ('COMPLETED','CANCELLED') AND EXISTS (SELECT 1 FROM receipt_registrations r WHERE r.batch_id=b.batch_id AND r.status<>'SAVED') ORDER BY b.updated_at DESC LIMIT 1`);
  return batch?receiptBatchSnapshot(batch.batch_id):null;
}

export async function listReceiptRegistrations(filters = {}) {
  const where = ["r.status='SAVED'"]; const params = {};
  const ids = Array.isArray(filters.group_ids) ? filters.group_ids.map(value=>clean(value,64)).filter(Boolean) : filters.group_id ? [clean(filters.group_id,64)] : [];
  if (ids.length) { where.push(`r.group_id IN (${ids.map((_,index)=>`:group${index}`).join(',')})`); ids.forEach((id,index)=>{params[`group${index}`]=id;}); }
  if (filters.search) { where.push("LOWER(CONCAT_WS(' ',r.full_name,r.nickname,r.national_id,r.address,g.group_name,g.site_code,g.province)) LIKE :search"); params.search=`%${clean(filters.search,180).toLowerCase()}%`; }
  const rows=await select(`SELECT r.*,COALESCE(NULLIF(w.nickname,''),r.nickname) AS nickname,COALESCE(NULLIF(w.daily_wage,0),r.daily_wage) AS daily_wage,COALESCE(NULLIF(w.note,''),r.note) AS note,g.group_name,g.group_type,g.site_code,g.province FROM receipt_registrations r LEFT JOIN workers w ON w.worker_id=r.worker_id LEFT JOIN labor_groups g ON g.group_id=r.group_id WHERE ${where.join(' AND ')} ORDER BY g.group_name,r.full_name LIMIT 5000`,params);
  return { rows:rows.map(row=>registrationForClient(row)), total:rows.length };
}

export async function getReceiptWorkspace(filters = {}) {
  const [templates,groups,projects,sites,registrations,activeBatch]=await Promise.all([select('SELECT template_id,template_name,source_file_name,source_format,page_count,placeholders,active,created_at,updated_at FROM receipt_templates WHERE active=1 ORDER BY updated_at DESC'),groupsWithProjects(),select('SELECT * FROM projects WHERE active=1 ORDER BY project_name'),reportSites(),listReceiptRegistrations(filters),latestActiveReceiptBatch()]);
  const enabled=!!config.passwordHash&&!!config.receiptGeminiApiKey;
  const securityMessage=!config.passwordHash?'ผู้ดูแลยังไม่ได้ตั้งรหัสผ่าน WorkHub':!config.receiptGeminiApiKey?'ยังไม่ได้ตั้งค่า Gemini API สำหรับเอกสารใบรับเงิน':'';
  return { enabled, securityMessage, aiConfigured:!!config.receiptGeminiApiKey, aiModel:config.receiptGeminiModel, templates:templates.map(publicRow), groups, projects:projects.map(publicRow), reportSites:sites, registrations, activeBatch };
}

export async function saveLaborGroup(payload={}) {
  let name=clean(payload.group_name,255); const type=clean(payload.group_type,80).toUpperCase(); const projectId=clean(payload.project_id,64),reportSiteId=clean(payload.report_site_id,80);
  if(!['PERMANENT','SITE','OTHER'].includes(type))throw apiError('INVALID_GROUP_TYPE','ประเภทกลุ่มแรงงานไม่ถูกต้อง');
  let siteCode='',province='';
  if(type==='SITE'&&reportSiteId){const site=(await reportSites()).find(item=>item.report_site_id===reportSiteId);if(!site)throw apiError('REPORT_SITE_NOT_FOUND','ไม่พบไซต์จากส่วนรายงาน');name=name||site.site_name||site.site_id;siteCode=site.site_code;province=site.province;}
  if(type==='SITE'&&!reportSiteId&&projectId&&!await one('SELECT project_id FROM projects WHERE project_id=:id AND active=1',{id:projectId}))throw apiError('PROJECT_REQUIRED','ไม่พบไซต์งานที่เลือก');
  if(!name)throw apiError('GROUP_NAME_REQUIRED','กรุณาระบุชื่อกลุ่มแรงงาน');
  const existing=await one('SELECT group_id FROM labor_groups WHERE active=1 AND LOWER(group_name)=LOWER(:name) AND group_id<>:id',{name,id:clean(payload.group_id,64)});if(existing)throw apiError('DUPLICATE_GROUP','มีชื่อกลุ่มนี้แล้ว');
  const id=clean(payload.group_id,64)||uuid(); const timestamp=nowSql();
  await execute("INSERT INTO labor_groups (group_id,group_name,group_type,project_id,report_site_id,site_code,province,active,created_at,updated_at) VALUES (:id,:name,:type,:project,:reportSite,:siteCode,:province,1,:created,:updated) ON DUPLICATE KEY UPDATE group_name=VALUES(group_name),group_type=VALUES(group_type),project_id=VALUES(project_id),report_site_id=VALUES(report_site_id),site_code=VALUES(site_code),province=VALUES(province),active=1,updated_at=VALUES(updated_at)",{id,name,type,project:type==='SITE'?projectId:'',reportSite:type==='SITE'?reportSiteId:'',siteCode,province,created:timestamp,updated:timestamp});
  return (await groupsWithProjects()).find(group=>group.group_id===id);
}

async function convertDoc(buffer,fileName){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'workhub-doc-'));try{const input=path.join(directory,safeName(fileName,'template.doc'));await fs.writeFile(input,buffer);await run('libreoffice',['--headless','--convert-to','docx','--outdir',directory,input],{timeout:120000,maxBuffer:1024*1024});const output=path.join(directory,path.basename(input).replace(/\.doc$/i,'.docx'));return await fs.readFile(output);}catch(error){throw apiError('DOC_CONVERSION_FAILED',`แปลงไฟล์ DOC ไม่สำเร็จ: ${clean(error.message,300)}`);}finally{await fs.rm(directory,{recursive:true,force:true});}}

export async function saveReceiptTemplate(payload={}) {
  const fileName=safeName(payload.file_name,'template.docx'); const extension=path.extname(fileName).toLowerCase(); const name=clean(payload.template_name||fileName.replace(/\.docx?$/i,''),255);
  if(!['.doc','.docx'].includes(extension))throw apiError('TEMPLATE_FORMAT','รองรับ Template เฉพาะไฟล์ DOC และ DOCX');
  const parsed=parseDataUrl(payload.data_url,['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream']);if(parsed.buffer.length>8*1024*1024)throw apiError('TEMPLATE_TOO_LARGE','Template ต้องมีขนาดไม่เกิน 8 MB');
  const source=await storeBuffer('templates',fileName,parsed.buffer);let normalized=null;
  try{const docx=extension==='.doc'?await convertDoc(parsed.buffer,fileName):parsed.buffer;const validation=await inspectTemplate(docx);normalized=await storeBuffer('templates',`${name}-normalized.docx`,docx);const id=uuid();const timestamp=nowSql();await execute('INSERT INTO receipt_templates (template_id,template_name,source_file_name,source_path,normalized_path,source_format,page_count,placeholders,active,created_at,updated_at) VALUES (:id,:name,:fileName,:source,:normalized,:format,:pages,:holders,1,:created,:updated)',{id,name,fileName,source:source.relative,normalized:normalized.relative,format:extension.slice(1).toUpperCase(),pages:validation.pageCount,holders:JSON.stringify(validation.placeholders),created:timestamp,updated:timestamp});return publicRow(await one('SELECT template_id,template_name,source_file_name,source_format,page_count,placeholders,active,created_at,updated_at FROM receipt_templates WHERE template_id=:id',{id}));}catch(error){await removeFile(source.relative);if(normalized)await removeFile(normalized.relative);throw error;}
}

export async function downloadReceiptTemplate(payload={},createTicket) {
  const id=clean(payload.template_id,64),template=await one('SELECT * FROM receipt_templates WHERE template_id=:id AND active=1',{id});
  if(!template)throw apiError('TEMPLATE_NOT_FOUND','ไม่พบ Template ที่ต้องการดาวน์โหลด');
  const format=clean(template.source_format,12).toUpperCase()==='DOC'?'DOC':'DOCX',mime=format==='DOC'?'application/msword':DOCX_MIME,fileName=safeName(template.source_file_name||`${template.template_name}.${format.toLowerCase()}`,`template.${format.toLowerCase()}`);
  return createTicket(await readBuffer(template.source_path),fileName,mime,1,null);
}

export async function deleteReceiptTemplate(payload={}) {
  const id=clean(payload.template_id,64),template=await one('SELECT * FROM receipt_templates WHERE template_id=:id AND active=1',{id});
  if(!template)throw apiError('TEMPLATE_NOT_FOUND','ไม่พบ Template ที่ต้องการลบ');
  const activeBatch=await one("SELECT batch_id FROM receipt_batches WHERE template_id=:id AND status NOT IN ('COMPLETED','CANCELLED') LIMIT 1",{id});
  if(activeBatch)throw apiError('TEMPLATE_IN_USE','Template นี้กำลังถูกใช้ในชุด Quick Edit กรุณาบันทึกหรือยกเลิกชุดนั้นก่อน');
  await execute('UPDATE receipt_templates SET active=0,updated_at=:updated WHERE template_id=:id',{id,updated:nowSql()});
  return {deleted:true,template_id:id,template_name:template.template_name};
}

export async function createReceiptBatch(payload={}){const templateId=clean(payload.template_id,64),groupId=clean(payload.group_id,64),total=Math.trunc(number(payload.total_count));if(!await one('SELECT template_id FROM receipt_templates WHERE template_id=:id AND active=1',{id:templateId}))throw apiError('TEMPLATE_REQUIRED','กรุณาเลือก Template');if(!await one('SELECT group_id FROM labor_groups WHERE group_id=:id AND active=1',{id:groupId}))throw apiError('GROUP_REQUIRED','กรุณาเลือกกลุ่มแรงงาน');if(total<1||total>config.receiptMaxBatchCards)throw apiError('BATCH_SIZE',`อัปโหลดได้ครั้งละ 1-${config.receiptMaxBatchCards} รูป`);const id=uuid(),timestamp=nowSql();await execute('INSERT INTO receipt_batches (batch_id,template_id,group_id,status,total_count,processed_count,error_count,created_by,ai_model,last_error,created_at,updated_at) VALUES (:id,:template,:groupId,\'UPLOADING\',:total,0,0,:actor,:model,:error,:created,:updated)',{id,template:templateId,groupId,total,actor:clean(payload.created_by||'WEB',160),model:config.receiptGeminiModel,error:config.receiptGeminiApiKey?'':'ยังไม่ได้ตั้งค่า Gemini API รูปจะเก็บบน NAS และรอผู้ดูแลตั้งค่า',created:timestamp,updated:timestamp});return publicRow(await one('SELECT * FROM receipt_batches WHERE batch_id=:id',{id}));}

async function findDuplicate(nationalId,digest,exclude=''){return one("SELECT registration_id,worker_id,CASE WHEN national_id=:national AND :national<>'' THEN 'NATIONAL_ID' WHEN card_sha256=:digest THEN 'IMAGE' ELSE 'NAME' END AS duplicate_type FROM receipt_registrations WHERE registration_id<>:exclude AND status<>'REJECTED' AND ((national_id=:national AND :national<>'') OR card_sha256=:digest) ORDER BY updated_at DESC LIMIT 1",{national:nationalId,digest,exclude});}

export async function queueReceiptCard(payload={}) {
  const batch=await one('SELECT * FROM receipt_batches WHERE batch_id=:id',{id:clean(payload.batch_id,64)});
  if(!batch)throw apiError('BATCH_NOT_FOUND','ไม่พบชุดอัปโหลด');
  if(batch.status==='COMPLETED'||batch.status==='CANCELLED')throw apiError('BATCH_CLOSED','ชุดอัปโหลดนี้ปิดแล้ว');
  const count=await one('SELECT COUNT(*) AS total FROM receipt_registrations WHERE batch_id=:id',{id:batch.batch_id});
  if(number(count?.total)>=number(batch.total_count))throw apiError('BATCH_FULL','อัปโหลดรูปครบจำนวนของชุดนี้แล้ว');
  let stored;
  try {
    stored=await storeCompressedImage('receipt-cards',payload.file_name||'id-card.jpg',payload.data_url,{maxLongEdge:1600,quality:82});
    const duplicate=await findDuplicate('',stored.sha256);
    const id=uuid(),timestamp=nowSql();
    await execute(`INSERT INTO receipt_registrations (registration_id,batch_id,worker_id,template_id,group_id,full_name,first_name,last_name,national_id,address,card_path,card_file_name,card_sha256,card_size_bytes,ocr_confidence,ocr_warnings,duplicate_type,duplicate_of,status,ocr_provider,ai_model,ai_attempts,ai_last_error,created_at,updated_at)
      VALUES (:id,:batch,'',:template,:groupId,'','','','','',:path,:fileName,:sha,:size,0,'[]',:duplicateType,:duplicateOf,'AI_QUEUED','GEMINI',:model,0,:error,:created,:updated)`,{id,batch:batch.batch_id,template:batch.template_id,groupId:batch.group_id,path:stored.relative,fileName:stored.relative.split('/').pop(),sha:stored.sha256,size:stored.size,duplicateType:duplicate?.duplicate_type||'',duplicateOf:duplicate?.registration_id||'',model:config.receiptGeminiModel,error:config.receiptGeminiApiKey?'':'รอตั้งค่า Gemini API',created:timestamp,updated:timestamp});
    const after=await one('SELECT COUNT(*) AS total FROM receipt_registrations WHERE batch_id=:id',{id:batch.batch_id});
    await execute("UPDATE receipt_batches SET processed_count=:count,status=:status,last_error='',updated_at=:updated WHERE batch_id=:id",{id:batch.batch_id,count:number(after?.total),status:number(after?.total)>=number(batch.total_count)?'AI_QUEUED':'UPLOADING',updated:timestamp});
    return registrationForClient(await one('SELECT * FROM receipt_registrations WHERE registration_id=:id',{id}));
  } catch(error) {
    if(stored)await removeFile(stored.relative);
    await execute("UPDATE receipt_batches SET error_count=error_count+1,last_error=:error,updated_at=:updated WHERE batch_id=:id",{id:batch.batch_id,error:clean(error.message,500),updated:nowSql()});
    throw error;
  }
}

async function refreshReceiptBatchState(batchId,lastError='') {
  const snapshot=await receiptBatchSnapshot(batchId);if(!snapshot)return null;
  const {counts}=snapshot;
  const status=counts.processing||counts.queued?'PROCESSING':counts.retry?'AI_WAITING':counts.failed?'AI_ACTION_REQUIRED':counts.ready?'REVIEW':'UPLOADING';
  await execute('UPDATE receipt_batches SET status=:status,error_count=:errors,last_error=:error,updated_at=:updated WHERE batch_id=:id',{id:batchId,status,errors:counts.retry,error:clean(lastError,500),updated:nowSql()});
  return receiptBatchSnapshot(batchId);
}

export async function processReceiptBatchAI(payload={}) {
  if(!config.receiptGeminiApiKey)throw apiError('RECEIPT_AI_NOT_CONFIGURED','ยังไม่ได้ตั้งค่า Gemini API สำหรับเอกสารใบรับเงิน',503);
  const batchId=clean(payload.batch_id,64),requestedIds=(Array.isArray(payload.registration_ids)?payload.registration_ids:[]).map(value=>clean(value,64)).filter(Boolean).slice(0,config.receiptAiImagesPerRequest);
  const batch=await one('SELECT * FROM receipt_batches WHERE batch_id=:id',{id:batchId});if(!batch)throw apiError('BATCH_NOT_FOUND','ไม่พบชุดอัปโหลด');
  const params={batch:batchId};let idCondition='';
  if(requestedIds.length){idCondition=` AND registration_id IN (${requestedIds.map((id,index)=>{params[`id${index}`]=id;return`:id${index}`;}).join(',')})`;}
  const allowedStatus=bool(payload.include_retry)?"('AI_QUEUED','AI_RETRY')":"('AI_QUEUED')";
  const dueCondition=bool(payload.worker)?' AND (ai_next_attempt_at IS NULL OR ai_next_attempt_at<=UTC_TIMESTAMP(3))':'';
  const rows=await transaction(async connection=>{
    const[selected]=await connection.execute(`SELECT * FROM receipt_registrations WHERE batch_id=:batch AND status IN ${allowedStatus}${dueCondition}${idCondition} ORDER BY created_at,registration_id LIMIT ${config.receiptAiImagesPerRequest} FOR UPDATE`,params);
    for(const row of selected)await connection.execute("UPDATE receipt_registrations SET status='AI_PROCESSING',ai_next_attempt_at=NULL,updated_at=? WHERE registration_id=?",[nowSql(),row.registration_id]);
    return selected;
  });
  if(!rows.length)return{processed:0,waiting:false,...await refreshReceiptBatchState(batchId)};
  try {
    const cards=await Promise.all(rows.map(async row=>({...row,buffer:await readBuffer(row.card_path)})));
    const highestAttempt=Math.max(...rows.map(row=>number(row.ai_attempts)),0),model=highestAttempt>=2?config.receiptGeminiFallbackModel:config.receiptGeminiModel;
    const results=await analyzeReceiptCards(cards,batchId,model);
    for(let index=0;index<rows.length;index+=1){
      const row=rows[index],raw=results.find(item=>number(item.image_index)===index+1);
      if(!raw){await execute("UPDATE receipt_registrations SET status='AI_RETRY',ai_attempts=ai_attempts+1,ai_last_error='AI ไม่ส่งข้อมูลของรูปนี้',updated_at=:updated WHERE registration_id=:id",{id:row.registration_id,updated:nowSql()});continue;}
      const normalized=normalizeReceiptAiResult(raw),duplicate=await findDuplicate(normalized.national,row.card_sha256,row.registration_id),timestamp=nowSql();
      await execute(`UPDATE receipt_registrations SET full_name=:fullName,first_name=:firstName,last_name=:lastName,national_id=:national,address=:address,ocr_confidence=:confidence,ocr_warnings=:warnings,duplicate_type=:duplicateType,duplicate_of=:duplicateOf,status='OCR_READY',ocr_provider='GEMINI',ai_model=:model,ai_attempts=ai_attempts+1,ai_last_error='',ai_next_attempt_at=NULL,ai_processed_at=:processed,updated_at=:updated WHERE registration_id=:id AND status='AI_PROCESSING'`,{id:row.registration_id,fullName:normalized.fullName,firstName:normalized.firstName,lastName:normalized.lastName,national:normalized.national,address:normalized.address,confidence:normalized.confidence,warnings:JSON.stringify(normalized.warnings),duplicateType:duplicate?.duplicate_type||'',duplicateOf:duplicate?.registration_id||'',model,processed:timestamp,updated:timestamp});
    }
    return{processed:rows.length,waiting:false,...await refreshReceiptBatchState(batchId)};
  } catch(error) {
    const retryable=[408,429,500,502,503,504].includes(number(error.httpStatus))||/timeout|fetch|traffic|capacity|overloaded|quota|rate/i.test(error.message);
    const message=retryable?'AI กำลังมีผู้ใช้งานหนาแน่น รูปถูกเก็บบน NAS แล้ว ระบบจะลองใหม่อัตโนมัติ':`AI อ่านข้อมูลไม่สำเร็จ: ${clean(error.message,300)}`;
    for(const row of rows){const attempts=number(row.ai_attempts)+1,terminal=!retryable||attempts>=config.receiptAiMaxAttempts,delay=Math.min(300,Math.max(number(error.retryAfterSeconds)||15,15*(2**Math.min(4,attempts-1))));await execute("UPDATE receipt_registrations SET status=:status,ai_attempts=:attempts,ai_last_error=:error,ai_next_attempt_at=IF(:terminal=1,NULL,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL :delay SECOND)),updated_at=:updated WHERE registration_id=:id AND status='AI_PROCESSING'",{id:row.registration_id,status:terminal?'AI_FAILED':'AI_RETRY',attempts,error:terminal?`${message} กรุณากดกรอกเองหรือลองใหม่`:message,terminal:terminal?1:0,delay,updated:nowSql()});}
    return{processed:0,waiting:true,retryable,retryAfterSeconds:number(error.retryAfterSeconds)||30,error:message,...await refreshReceiptBatchState(batchId,message)};
  }
}

export async function recoverReceiptAiJobs() {
  const timestamp=nowSql();
  const result=await execute("UPDATE receipt_registrations SET status='AI_RETRY',ai_last_error='งาน AI ถูกขัดจังหวะ สามารถกดทำต่อได้',updated_at=:updated WHERE status='AI_PROCESSING' AND updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)",{updated:timestamp});
  if(result.affectedRows)await execute("UPDATE receipt_batches b SET b.status='AI_WAITING',b.last_error='งาน AI ถูกขัดจังหวะ สามารถกดทำต่อได้',b.updated_at=:updated WHERE EXISTS (SELECT 1 FROM receipt_registrations r WHERE r.batch_id=b.batch_id AND r.status='AI_RETRY')",{updated:timestamp});
  return result.affectedRows;
}

export async function processNextReceiptAiJob() {
  if(!config.receiptGeminiApiKey)return null;
  const row=await one("SELECT batch_id FROM receipt_registrations WHERE status IN ('AI_QUEUED','AI_RETRY') AND (ai_next_attempt_at IS NULL OR ai_next_attempt_at<=UTC_TIMESTAMP(3)) ORDER BY created_at LIMIT 1");
  return row?processReceiptBatchAI({batch_id:row.batch_id,include_retry:true,worker:true}):null;
}

export async function retryReceiptRegistration(payload={}) {
  const id=clean(payload.registration_id,64),row=await one("SELECT registration_id,batch_id FROM receipt_registrations WHERE registration_id=:id AND status IN ('AI_RETRY','AI_FAILED')",{id});
  if(!row)throw apiError('RECEIPT_RETRY_NOT_FOUND','ไม่พบรายการที่รอลองใหม่');
  await execute("UPDATE receipt_registrations SET status='AI_QUEUED',ai_attempts=0,ai_last_error='รอลองใหม่ตามคำสั่งผู้ใช้',ai_next_attempt_at=NULL,updated_at=:updated WHERE registration_id=:id",{id,updated:nowSql()});
  return receiptBatchSnapshot(row.batch_id);
}

export async function getReceiptCardPreview(payload={}) {
  const id=clean(payload.registration_id,64),row=await one('SELECT card_path,card_file_name FROM receipt_registrations WHERE registration_id=:id',{id});
  if(!row)throw apiError('REGISTRATION_NOT_FOUND','ไม่พบรูปบัตร',404);
  const buffer=await readBuffer(row.card_path),extension=path.extname(row.card_file_name||row.card_path).toLowerCase(),mime=extension==='.png'?'image/png':extension==='.webp'?'image/webp':'image/jpeg';
  return {registration_id:id,file_name:row.card_file_name,mime_type:mime,data_url:`data:${mime};base64,${buffer.toString('base64')}`};
}

export async function deleteReceiptRegistration(payload={}) {
  const id=clean(payload.registration_id,64),row=await one("SELECT * FROM receipt_registrations WHERE registration_id=:id AND status<>'SAVED'",{id});
  if(!row)throw apiError('REGISTRATION_DELETE_NOT_ALLOWED','ลบได้เฉพาะรายการที่ยังไม่บันทึก');
  await execute("DELETE FROM receipt_registrations WHERE registration_id=:id AND status<>'SAVED'",{id});
  await removeFile(row.card_path);
  await refreshReceiptBatchState(row.batch_id,'ลบรายการออกจากชุดแล้ว');
  return receiptBatchSnapshot(row.batch_id);
}

export async function cancelReceiptBatch(payload={}) {
  const id=clean(payload.batch_id,64),batch=await one('SELECT * FROM receipt_batches WHERE batch_id=:id',{id});
  if(!batch)throw apiError('BATCH_NOT_FOUND','ไม่พบชุดอัปโหลด');
  const saved=await one("SELECT COUNT(*) AS total FROM receipt_registrations WHERE batch_id=:id AND status='SAVED'",{id});
  if(number(saved?.total))throw apiError('BATCH_HAS_SAVED_ROWS','ชุดนี้มีรายชื่อที่บันทึกแล้ว จึงยกเลิกทั้งชุดไม่ได้');
  const files=await select('SELECT card_path FROM receipt_registrations WHERE batch_id=:id',{id});
  await transaction(async connection=>{await connection.execute('DELETE FROM receipt_registrations WHERE batch_id=?',[id]);await connection.execute("UPDATE receipt_batches SET status='CANCELLED',last_error='ยกเลิกโดยผู้ใช้',updated_at=? WHERE batch_id=?",[nowSql(),id]);});
  await Promise.all(files.map(file=>removeFile(file.card_path).catch(()=>{})));
  return {cancelled:true,batch_id:id};
}

export async function saveReceiptCardDraft(payload={}){const batch=await one('SELECT * FROM receipt_batches WHERE batch_id=:id',{id:clean(payload.batch_id,64)});if(!batch)throw apiError('BATCH_NOT_FOUND','ไม่พบชุดอัปโหลด');let stored;try{stored=await storeCompressedImage('receipt-cards',payload.file_name||'id-card.jpg',payload.data_url,{maxLongEdge:1600,quality:78});const input=payload.ocr&&typeof payload.ocr==='object'?payload.ocr:{};const names=splitName(input.full_name);const national=normalizeNationalId(input.national_id);const address=clean(input.address,1000).replace(/\s+/g,' ');const warnings=(Array.isArray(input.warnings)?input.warnings:[]).map(item=>clean(item,180)).filter(Boolean);if(national&&!validNationalId(national))warnings.push('เลขบัตรไม่ผ่าน checksum กรุณาตรวจสอบ');if(!names.fullName||!national||!address)warnings.push('OCR อ่านข้อมูลไม่ครบ กรุณาตรวจสอบและแก้ไขก่อนบันทึก');const duplicate=await findDuplicate(national,stored.sha256);const id=uuid(),timestamp=nowSql();await execute('INSERT INTO receipt_registrations (registration_id,batch_id,worker_id,template_id,group_id,full_name,first_name,last_name,national_id,address,card_path,card_file_name,card_sha256,card_size_bytes,ocr_confidence,ocr_warnings,duplicate_type,duplicate_of,status,created_at,updated_at) VALUES (:id,:batch,\'\',:template,:groupId,:fullName,:firstName,:lastName,:national,:address,:path,:fileName,:sha,:size,:confidence,:warnings,:duplicateType,:duplicateOf,\'OCR_READY\',:created,:updated)',{id,batch:batch.batch_id,template:batch.template_id,groupId:batch.group_id,...names,national,address,path:stored.relative,fileName:stored.relative.split('/').pop(),sha:stored.sha256,size:stored.size,confidence:Math.max(0,Math.min(100,number(input.confidence))),warnings:JSON.stringify([...new Set(warnings)]),duplicateType:duplicate?.duplicate_type||'',duplicateOf:duplicate?.registration_id||'',created:timestamp,updated:timestamp});await execute('UPDATE receipt_batches SET processed_count=processed_count+1,updated_at=:updated WHERE batch_id=:id',{id:batch.batch_id,updated:timestamp});return registrationForClient(await one('SELECT * FROM receipt_registrations WHERE registration_id=:id',{id}),true);}catch(error){if(stored)await removeFile(stored.relative);await execute('UPDATE receipt_batches SET error_count=error_count+1,updated_at=:updated WHERE batch_id=:id',{id:batch.batch_id,updated:nowSql()});throw error;}}

export async function saveReceiptRegistrations(payload={}){const batchId=clean(payload.batch_id,64),inputs=Array.isArray(payload.rows)?payload.rows:[];if(!batchId||!inputs.length)throw apiError('REGISTRATIONS_REQUIRED','ไม่พบรายการที่ต้องการบันทึก');if(inputs.length>config.receiptMaxBatchCards)throw apiError('BATCH_SIZE','จำนวนรายการเกินขีดจำกัด');return transaction(async connection=>{const saved=[];for(const input of inputs){const id=clean(input.registration_id,64);const[currentRows]=await connection.execute('SELECT * FROM receipt_registrations WHERE registration_id=? AND batch_id=? FOR UPDATE',[id,batchId]);const current=currentRows[0];if(!current)throw apiError('REGISTRATION_NOT_FOUND','ไม่พบรายการ OCR ที่ต้องการบันทึก');const names=splitName(input.full_name),national=normalizeNationalId(input.national_id),address=clean(input.address,1000).replace(/\s+/g,' '),nickname=clean(input.nickname,160),note=clean(input.note,1000),dailyWage=Math.max(0,number(input.daily_wage));if(!names.fullName||!national||!address)throw apiError('REQUIRED_FIELDS','กรุณากรอกชื่อ เลขบัตร และที่อยู่ให้ครบ');if(!validNationalId(national))throw apiError('INVALID_NATIONAL_ID',`เลขบัตรประชาชนของ ${names.fullName} ไม่ถูกต้อง`);const duplicate=await findDuplicate(national,current.card_sha256,id);if(duplicate&&!bool(input.allow_existing_worker))throw apiError('DUPLICATE_REGISTRATION',`${names.fullName} มีข้อมูลซ้ำ กรุณาเลือกเชื่อมกับบุคคลเดิม`);const timestamp=nowSql();let workerId=duplicate?.worker_id||'';if(!workerId){const[workerRows]=await connection.execute('SELECT worker_id FROM workers WHERE national_id=? LIMIT 1 FOR UPDATE',[national]);workerId=workerRows[0]?.worker_id||uuid();}await connection.execute("INSERT INTO workers (worker_id,full_name,first_name,last_name,national_id,address,nickname,daily_wage,note,wage_effective_date,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_DATE(),'ACTIVE',?,?) ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),first_name=VALUES(first_name),last_name=VALUES(last_name),address=VALUES(address),nickname=VALUES(nickname),daily_wage=VALUES(daily_wage),note=VALUES(note),status='ACTIVE',updated_at=VALUES(updated_at)",[workerId,names.fullName,names.firstName,names.lastName,national,address,nickname,dailyWage,note,timestamp,timestamp]);await connection.execute('UPDATE worker_group_members SET active=0,updated_at=? WHERE worker_id=?',[timestamp,workerId]);const membershipId=uuid();await connection.execute('INSERT INTO worker_group_members (membership_id,worker_id,group_id,active,created_at,updated_at) VALUES (?,?,?,1,?,?) ON DUPLICATE KEY UPDATE active=1,updated_at=VALUES(updated_at)',[membershipId,workerId,current.group_id,timestamp,timestamp]);await connection.execute("UPDATE receipt_registrations SET worker_id=?,full_name=?,first_name=?,last_name=?,national_id=?,address=?,nickname=?,daily_wage=?,note=?,duplicate_type=?,duplicate_of=?,status='SAVED',updated_at=? WHERE registration_id=?",[workerId,names.fullName,names.firstName,names.lastName,national,address,nickname,dailyWage,note,duplicate?.duplicate_type||'',duplicate?.registration_id||'',timestamp,id]);const[rows]=await connection.execute('SELECT * FROM receipt_registrations WHERE registration_id=?',[id]);saved.push(registrationForClient(rows[0]));}await connection.execute('UPDATE receipt_batches SET status=\'COMPLETED\',updated_at=? WHERE batch_id=?',[nowSql(),batchId]);return{saved,count:saved.length};});}

export async function saveReceiptExportOption(payload={}) {
  const id=clean(payload.registration_id,64),current=await one("SELECT registration_id FROM receipt_registrations WHERE registration_id=:id AND status='SAVED'",{id});
  if(!current)throw apiError('REGISTRATION_NOT_FOUND','ไม่พบรายชื่อที่ต้องการแก้ไข');
  const item=clean(payload.receipt_item||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ',500),include=bool(payload.include_receipt_item)?1:0;
  await execute('UPDATE receipt_registrations SET receipt_item=:item,include_receipt_item=:include,updated_at=:updated WHERE registration_id=:id',{id,item,include,updated:nowSql()});
  return registrationForClient(await one(`SELECT r.*,g.group_name,g.group_type,g.site_code,g.province FROM receipt_registrations r LEFT JOIN labor_groups g ON g.group_id=r.group_id WHERE r.registration_id=:id`,{id}));
}

export async function saveReceiptRegistrationEntry(payload={}) {
  const id=clean(payload.registration_id,64),current=await one("SELECT * FROM receipt_registrations WHERE registration_id=:id AND status='SAVED'",{id});
  if(!current)throw apiError('REGISTRATION_NOT_FOUND','ไม่พบรายชื่อที่ต้องการแก้ไข');
  const names=splitName(payload.full_name),national=normalizeNationalId(payload.national_id),address=clean(payload.address,1000).replace(/\s+/g,' '),nickname=clean(payload.nickname,160),note=clean(payload.note,1000),dailyWage=Math.max(0,number(payload.daily_wage)),receiptItem=clean(payload.receipt_item||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ',500),include=bool(payload.include_receipt_item)?1:0;
  if(!names.fullName||!national||!address)throw apiError('REQUIRED_FIELDS','กรุณากรอกชื่อ เลขบัตร และที่อยู่ให้ครบ');
  if(!validNationalId(national))throw apiError('INVALID_NATIONAL_ID','เลขบัตรประชาชนไม่ถูกต้อง');
  const duplicate=await one("SELECT registration_id FROM receipt_registrations WHERE national_id=:national AND registration_id<>:id AND status='SAVED' LIMIT 1",{national,id});
  if(duplicate&&national!==normalizeNationalId(current.national_id))throw apiError('DUPLICATE_NATIONAL_ID','เลขบัตรประชาชนนี้มีในทะเบียนแล้ว');
  const timestamp=nowSql();
  await transaction(async connection=>{
    if(current.worker_id){
      await connection.execute("UPDATE workers SET full_name=?,first_name=?,last_name=?,national_id=?,address=?,nickname=?,daily_wage=?,note=?,updated_at=? WHERE worker_id=?",[names.fullName,names.firstName,names.lastName,national,address,nickname,dailyWage,note,timestamp,current.worker_id]);
      await connection.execute("UPDATE receipt_registrations SET full_name=?,first_name=?,last_name=?,national_id=?,address=?,nickname=?,daily_wage=?,note=?,updated_at=? WHERE worker_id=? AND status='SAVED'",[names.fullName,names.firstName,names.lastName,national,address,nickname,dailyWage,note,timestamp,current.worker_id]);
    }else await connection.execute('UPDATE receipt_registrations SET full_name=?,first_name=?,last_name=?,national_id=?,address=?,nickname=?,daily_wage=?,note=?,updated_at=? WHERE registration_id=?',[names.fullName,names.firstName,names.lastName,national,address,nickname,dailyWage,note,timestamp,id]);
    await connection.execute('UPDATE receipt_registrations SET receipt_item=?,include_receipt_item=?,updated_at=? WHERE registration_id=?',[receiptItem,include,timestamp,id]);
  });
  return registrationForClient(await one(`SELECT r.*,g.group_name,g.group_type,g.site_code,g.province FROM receipt_registrations r LEFT JOIN labor_groups g ON g.group_id=r.group_id WHERE r.registration_id=:id`,{id}));
}

export async function getPayrollRegistry() {
  const [groups,workers,sites]=await Promise.all([groupsWithProjects(),select(`SELECT w.*,m.group_id,g.group_name,g.site_code,g.province
    FROM workers w LEFT JOIN worker_group_members m ON m.worker_id=w.worker_id AND m.active=1
    LEFT JOIN labor_groups g ON g.group_id=m.group_id WHERE w.status<>'DELETED' ORDER BY w.full_name`),reportSites()]);
  return {groups,reportSites:sites,workers:workers.map(row=>publicRow({...row,national_id_masked:maskNationalId(row.national_id)}))};
}

export async function savePayrollWorker(payload={}) {
  const workerId=clean(payload.worker_id||payload.id,64)||uuid(),names=splitName(payload.full_name||payload.fullName),nickname=clean(payload.nickname,160),address=clean(payload.address,1000),note=clean(payload.note,1000),groupId=clean(payload.group_id||payload.groupId,64),dailyWage=Math.max(0,number(payload.daily_wage??payload.dailyRate)),otRate=Math.max(0,number(payload.ot_rate??payload.otRate)),effectiveDate=/^\d{4}-\d{2}-\d{2}$/.test(String(payload.effective_date||payload.effectiveDate||''))?String(payload.effective_date||payload.effectiveDate):null,status=clean(payload.status||'ACTIVE',32).toUpperCase();
  if(!names.fullName)throw apiError('WORKER_NAME_REQUIRED','กรุณาระบุชื่อพนักงาน');if(groupId&&!await one('SELECT group_id FROM labor_groups WHERE group_id=:id AND active=1',{id:groupId}))throw apiError('GROUP_NOT_FOUND','ไม่พบกลุ่มแรงงานที่เลือก');
  const current=await one('SELECT * FROM workers WHERE worker_id=:id',{id:workerId}),national=normalizeNationalId(payload.national_id||current?.national_id||'');if(national&&!validNationalId(national))throw apiError('INVALID_NATIONAL_ID','เลขบัตรประชาชนไม่ถูกต้อง');if(national&&await one('SELECT worker_id FROM workers WHERE national_id=:national AND worker_id<>:id',{national,id:workerId}))throw apiError('DUPLICATE_NATIONAL_ID','เลขบัตรประชาชนนี้มีในทะเบียนแล้ว');const timestamp=nowSql();
  await transaction(async connection=>{await connection.execute("INSERT INTO workers (worker_id,full_name,first_name,last_name,national_id,address,nickname,daily_wage,note,wage_effective_date,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?) ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),first_name=VALUES(first_name),last_name=VALUES(last_name),address=VALUES(address),nickname=VALUES(nickname),daily_wage=VALUES(daily_wage),note=VALUES(note),wage_effective_date=VALUES(wage_effective_date),status=VALUES(status),updated_at=VALUES(updated_at)",[workerId,names.fullName,names.firstName,names.lastName,national,address||current?.address||'',nickname,dailyWage,note,effectiveDate,status==='PAUSED'?'PAUSED':'ACTIVE',timestamp,timestamp]);if(groupId){await connection.execute('UPDATE worker_group_members SET active=0,updated_at=? WHERE worker_id=?',[timestamp,workerId]);await connection.execute('INSERT INTO worker_group_members (membership_id,worker_id,group_id,active,created_at,updated_at) VALUES (?,?,?,1,?,?) ON DUPLICATE KEY UPDATE active=1,updated_at=VALUES(updated_at)',[uuid(),workerId,groupId,timestamp,timestamp]);}await connection.execute("UPDATE receipt_registrations SET full_name=?,first_name=?,last_name=?,address=?,nickname=?,daily_wage=?,note=?,group_id=IF(?='',group_id,?),updated_at=? WHERE worker_id=? AND status='SAVED'",[names.fullName,names.firstName,names.lastName,address||current?.address||'',nickname,dailyWage,note,groupId,groupId,timestamp,workerId]);});
  const registry=await getPayrollRegistry();return registry.workers.find(worker=>worker.worker_id===workerId);
}

async function resolveSelection(payload,max){const ids=Array.isArray(payload.registration_ids)?payload.registration_ids.map(value=>clean(value,64)).filter(Boolean):[];const groups=Array.isArray(payload.group_ids)?payload.group_ids.map(value=>clean(value,64)).filter(Boolean):[];if(!ids.length&&!groups.length)throw apiError('EXPORT_SELECTION_REQUIRED','กรุณาเลือกรายชื่อหรือกลุ่มที่ต้องการ Export');const params={};let condition;if(ids.length){condition=`registration_id IN (${ids.map((id,index)=>{params[`id${index}`]=id;return`:id${index}`;}).join(',')})`;}else{condition=`group_id IN (${groups.map((id,index)=>{params[`group${index}`]=id;return`:group${index}`;}).join(',')})`;}const rows=await select(`SELECT * FROM receipt_registrations WHERE status='SAVED' AND ${condition} ORDER BY group_id,full_name`,params);if(!rows.length)throw apiError('EXPORT_EMPTY','ไม่พบรายชื่อที่พร้อม Export');if(rows.length>max)throw apiError('EXPORT_LIMIT',`Export ได้สูงสุด ${max} คนต่อครั้ง`);return rows;}

export async function previewReceiptExport(payload={}){const rows=await resolveSelection(payload,5000),groups=await groupsWithProjects(),map=new Map(groups.map(group=>[group.group_id,group])),grouped=new Map();for(const row of rows){const group=map.get(row.group_id)||{group_id:row.group_id,group_name:'ไม่ระบุกลุ่ม',site_name:''};const item=grouped.get(group.group_id)||{group_id:group.group_id,group_name:group.group_name,site_name:group.site_name||'',site_code:group.site_code||'',province:group.province||'',people:[]};item.people.push({registration_id:row.registration_id,full_name:row.full_name,national_id_masked:maskNationalId(row.national_id),receipt_item:row.receipt_item||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ',include_receipt_item:!!number(row.include_receipt_item)});grouped.set(group.group_id,item);}return{total:rows.length,groups:[...grouped.values()]};}

export async function exportReceiptRosterExcel(payload,createTicket){const rows=await resolveSelection(payload,5000),groups=await groupsWithProjects(),map=new Map(groups.map(group=>[group.group_id,group]));const workerIds=[...new Set(rows.map(row=>row.worker_id).filter(Boolean))],workers=new Map();if(workerIds.length){const params={};workerIds.forEach((id,index)=>{params[`id${index}`]=id;});(await select(`SELECT worker_id,nickname,daily_wage,note FROM workers WHERE worker_id IN (${workerIds.map((_,index)=>`:id${index}`).join(',')})`,params)).forEach(worker=>workers.set(worker.worker_id,worker));}const values=rows.map((row,index)=>{const group=map.get(row.group_id)||{},worker=workers.get(row.worker_id)||row;return[index+1,row.worker_id,row.full_name,worker.nickname||'',row.national_id,row.address,Number(worker.daily_wage)||0,worker.note||'',group.group_name||'',group.site_code||group.site_name||'',group.province||'',number(row.include_receipt_item)?row.receipt_item||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ':'',number(row.include_receipt_item)?'ใส่':'ไม่ใส่',row.updated_at];});const buffer=await createXlsx('รายชื่อแรงงาน',['ลำดับ','รหัสบุคคล','ชื่อ-นามสกุล','ชื่อเล่น','เลขบัตรประชาชน','ที่อยู่','ค่าแรง/วัน','หมายเหตุ','กลุ่มแรงงาน','Site Code','จังหวัด','รายการรับเงิน','ใช้ในเอกสาร','วันที่บันทึก'],values,[8,24,30,18,20,55,14,30,28,22,18,42,14,24]);return createTicket(buffer,`รายชื่อใบรับเงิน_${new Date().toISOString().slice(0,10)}_${rows.length}คน.xlsx`,XLSX_MIME,rows.length,{format:'XLSX',rows,payload});}

export async function exportReceiptDocuments(payload,createTicket){const rows=await resolveSelection(payload,200),templateId=clean(payload.template_id,64)||rows[0].template_id,template=await one('SELECT * FROM receipt_templates WHERE template_id=:id AND active=1',{id:templateId});if(!template)throw apiError('TEMPLATE_NOT_FOUND','ไม่พบ Template ที่เลือก');if(rows.some(row=>row.template_id!==templateId)&&!bool(payload.force_template))throw apiError('MIXED_TEMPLATES','รายการที่เลือกใช้หลาย Template');const registrations=[];for(const row of rows)registrations.push({...row,cardBuffer:await readBuffer(row.card_path)});const buffer=await createReceiptDocx(await readBuffer(template.normalized_path),registrations);return createTicket(buffer,`ใบรับเงิน_${new Date().toISOString().slice(0,10)}_${rows.length}คน.docx`,DOCX_MIME,rows.length,{format:'DOCX',templateId,rows,payload});}
