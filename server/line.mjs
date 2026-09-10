import crypto from 'node:crypto';
import { config } from './config.mjs';
import { execute, one, select, transaction } from './db.mjs';
import { readBuffer, removeFile, storeCompressedImage } from './files.mjs';
import { clean, nowSql, number, uuid } from './utils.mjs';
import { getQuickSettings } from './actions/masters.mjs';
import { confirmBill, deleteBill, normalizeQualityScore, submitBillPages } from './actions/bills.mjs';

const LINE_API = 'https://api.line.me';
const LINE_DATA_API = 'https://api-data.line.me';
const ACTIVE_SESSION_STATUSES = ['AWAITING_PAGE_COUNT','COLLECTING_PAGES','AWAITING_PROJECT','AWAITING_COMPANY','PROCESSING'];

export function verifyLineSignature(rawBody, signature, secret = config.lineChannelSecret) {
  if (!secret || !signature || typeof rawBody !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let received;
  try { received = Buffer.from(String(signature), 'base64'); } catch { return false; }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function targetOf(source = {}) { return clean(source.groupId || source.roomId || source.userId, 160); }
function userOf(source = {}) { return clean(source.userId, 160); }
function sourceTypeOf(source = {}) { return clean(source.type, 40); }
function message(text, quickReply) { const result={type:'text',text:clean(text,5000)};if(quickReply?.length)result.quickReply={items:quickReply};return result; }
function postback(label, data, displayText) { return {type:'action',action:{type:'postback',label:clean(label,20),data:clean(data,300),displayText:clean(displayText,300)}}; }

async function lineRequest(path, { method='GET', body, binary=false } = {}) {
  if (!config.lineChannelAccessToken) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN บน NAS');
  const response = await fetch(`${binary?LINE_DATA_API:LINE_API}${path}`, {
    method,
    headers:{Authorization:`Bearer ${config.lineChannelAccessToken}`,...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(binary?30000:15000),
  });
  if (!response.ok) {
    const detail=clean(await response.text().catch(()=>''),400);
    throw new Error(`LINE API ${response.status}${detail?`: ${detail}`:''}`);
  }
  if (binary) {
    const length=Number(response.headers.get('content-length')||0);
    if(length>config.lineMaxImageBytes)throw new Error('รูปจาก LINE มีขนาดใหญ่เกินกำหนด');
    const buffer=Buffer.from(await response.arrayBuffer());
    if(!buffer.length||buffer.length>config.lineMaxImageBytes)throw new Error('รูปจาก LINE ว่างหรือมีขนาดใหญ่เกินกำหนด');
    return {buffer,mime:clean(response.headers.get('content-type')||'image/jpeg',80).split(';')[0].toLowerCase()};
  }
  const text=await response.text();
  return text?JSON.parse(text):{};
}

async function reply(replyToken, messages) {
  if(!replyToken)return;
  await lineRequest('/v2/bot/message/reply',{method:'POST',body:{replyToken,messages:messages.slice(0,5)}});
}
async function push(target, messages) {
  if(!target)return;
  await lineRequest('/v2/bot/message/push',{method:'POST',body:{to:target,messages:messages.slice(0,5)}});
}

async function pushWithRetry(target, messages) {
  let lastError;
  for(let attempt=1;attempt<=3;attempt+=1){
    try{return await push(target,messages);}catch(error){lastError=error;if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*450));}
  }
  throw lastError;
}

async function reserveEvent(event) {
  const eventId=clean(event.webhookEventId,160)||crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const source=event.source||{};
  const result=await execute("INSERT IGNORE INTO line_webhook_events (event_id,event_type,source_type,source_id,message_id,status,error,created_at) VALUES (:id,:type,:sourceType,:sourceId,:messageId,'PROCESSING','',:created)",{
    id:eventId,type:clean(event.type,80),sourceType:sourceTypeOf(source),sourceId:targetOf(source),messageId:clean(event.message?.id,160),created:nowSql(),
  });
  return result.affectedRows===1?eventId:'';
}
async function finishEvent(eventId,status,error='') { await execute('UPDATE line_webhook_events SET status=:status,error=:error,completed_at=:completed WHERE event_id=:id',{id:eventId,status,error:clean(error,1000),completed:nowSql()}); }

function expiresSql() { return new Date(Date.now()+config.lineSessionHours*3600000).toISOString().slice(0,23).replace('T',' '); }

async function activeSession(userId,contextId) {
  return one(`SELECT * FROM upload_sessions WHERE source='LINE' AND source_user_id=:user AND source_context_id=:context AND status IN (${ACTIVE_SESSION_STATUSES.map((_,i)=>`:s${i}`).join(',')}) AND expires_at>UTC_TIMESTAMP(3) ORDER BY created_at DESC LIMIT 1`,{user:userId,context:contextId,...Object.fromEntries(ACTIVE_SESSION_STATUSES.map((value,i)=>[`s${i}`,value]))});
}

async function createSession(userId,contextId) {
  const id=uuid(),timestamp=nowSql();
  await execute("INSERT INTO upload_sessions (session_id,project_id,company_id,expected_pages,received_pages,status,source,source_user_id,source_context_id,created_at,expires_at,updated_at) VALUES (:id,'','',0,0,'AWAITING_PAGE_COUNT','LINE',:user,:context,:created,:expires,:updated)",{id,user:userId,context:contextId,created:timestamp,expires:expiresSql(),updated:timestamp});
  return one('SELECT * FROM upload_sessions WHERE session_id=:id',{id});
}

async function requireSession(sessionId,userId,contextId) {
  const row=await one('SELECT * FROM upload_sessions WHERE session_id=:id AND source=\'LINE\' AND source_user_id=:user AND source_context_id=:context',{id:clean(sessionId,64),user:userId,context:contextId});
  if(!row||!ACTIVE_SESSION_STATUSES.includes(row.status)||new Date(String(row.expires_at).replace(' ','T')+'Z').getTime()<=Date.now())throw new Error('รายการนี้ดำเนินการไปแล้วหรือหมดอายุ กรุณาส่งรูปใหม่');
  return row;
}

async function saveLineImage(session,messageId,pageNo) {
  const downloaded=await lineRequest(`/v2/bot/message/${encodeURIComponent(messageId)}/content`,{binary:true});
  if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(downloaded.mime))throw new Error('ชนิดรูปจาก LINE ไม่รองรับ');
  const dataUrl=`data:${downloaded.mime};base64,${downloaded.buffer.toString('base64')}`;
  const stored=await storeCompressedImage('line-inbox',`${session.session_id.slice(0,8)}-p${pageNo}.jpg`,dataUrl,{maxLongEdge:2000,quality:82});
  try {
    await execute('INSERT INTO line_upload_pages (session_id,page_no,message_id,file_path,file_name,mime_type,sha256,size_bytes,original_size_bytes,compression,width,height,created_at) VALUES (:session,:page,:message,:path,:name,:mime,:sha,:size,:original,:compression,:width,:height,:created)',{session:session.session_id,page:pageNo,message:messageId,path:stored.relative,name:stored.relative.split('/').pop(),mime:stored.mime,sha:stored.sha256,size:stored.size,original:stored.originalSize,compression:stored.compression,width:stored.width,height:stored.height,created:nowSql()});
  } catch(error) { await removeFile(stored.relative); throw error; }
}

function pageCountMessage(sessionId,received,quick) {
  const configured=(quick?.slots||[]).filter(item=>item.configured);
  const body=[
    {type:'box',layout:'vertical',cornerRadius:'18px',backgroundColor:'#F8EADB',paddingAll:'16px',contents:[
      {type:'text',text:'บิลทั่วไปเลือก “1 หน้า (ใบเดียว)”',color:'#7C4D3A',weight:'bold',size:'sm',wrap:true},
      {type:'text',text:'หากเป็นเอกสารต่อเนื่องหลายหน้า ให้เลือกจำนวนหน้ารวมทั้งหมด',color:'#8C756A',size:'xs',margin:'md',wrap:true},
    ]},
  ];
  for(const slot of configured){
    body.push({type:'box',layout:'vertical',cornerRadius:'18px',backgroundColor:'#F6E4D1',paddingAll:'16px',margin:'lg',contents:[
      {type:'text',text:`⚡ ${slot.label}`,color:'#8A4B2F',weight:'bold',size:'lg'},
      {type:'box',layout:'baseline',margin:'md',contents:[{type:'text',text:'จำนวนหน้า',color:'#8C756A',size:'sm',flex:3},{type:'text',text:`${slot.page_count} หน้า`,color:'#44312A',weight:'bold',size:'sm',align:'end',flex:4}]},
      {type:'box',layout:'baseline',contents:[{type:'text',text:'โครงการ',color:'#8C756A',size:'sm',flex:3},{type:'text',text:clean(slot.project_name,100),color:'#44312A',weight:'bold',size:'sm',align:'end',wrap:true,flex:4}]},
      {type:'box',layout:'baseline',contents:[{type:'text',text:'บริษัท',color:'#8C756A',size:'sm',flex:3},{type:'text',text:clean(slot.company_name,100),color:'#44312A',weight:'bold',size:'sm',align:'end',wrap:true,flex:4}]},
    ]});
    body.push({type:'button',style:'primary',height:'sm',color:'#A1603D',margin:'md',action:{type:'postback',label:`ใช้${slot.label}`,data:`action=use_quick_settings&session_id=${sessionId}&slot=${slot.slot}`,displayText:`ใช้${slot.label} สำหรับบิลนี้`}});
  }
  body.push({type:'separator',margin:'xl',color:'#E1CDBD'},{type:'text',text:'หรือกำหนดจำนวนหน้าเอง',color:'#795442',weight:'bold',size:'sm',margin:'lg'});
  const counts=[];
  for(let count=received;count<=config.maxPagesPerBill;count+=2){
    const columns=[];
    for(const value of [count,count+1])if(value<=config.maxPagesPerBill)columns.push({type:'button',style:'primary',height:'sm',color:'#604437',flex:1,action:{type:'postback',label:value===1?'1 หน้า (ใบเดียว)':`${value} หน้า`,data:`action=set_pages&session_id=${sessionId}&pages=${value}`,displayText:`บิลนี้มี ${value} หน้า`}});
    body.push({type:'box',layout:'horizontal',spacing:'sm',margin:counts.length?'sm':'md',contents:columns});counts.push(count);
  }
  body.push({type:'button',style:'secondary',height:'sm',margin:'xl',color:'#B84C3F',action:{type:'postback',label:'ยกเลิกรูปนี้',data:`action=cancel_session&session_id=${sessionId}`,displayText:'ยกเลิกรูปที่ส่งล่าสุด'}});
  return {type:'flex',altText:'เลือกวิธีรับบิลหรือยกเลิก',contents:{type:'bubble',size:'mega',header:{type:'box',layout:'vertical',backgroundColor:'#2D211C',paddingAll:'22px',contents:[{type:'text',text:'เตรียมอ่านบิลด้วย AI',color:'#E3BE72',weight:'bold',size:'sm'},{type:'text',text:'เลือกวิธีรับบิล',color:'#FFFFFF',weight:'bold',size:'xxl',margin:'md'},{type:'text',text:'ใช้ค่าลัดเพื่อข้ามการเลือกโครงการและบริษัท',color:'#D8C8C0',size:'sm',margin:'sm',wrap:true}]},body:{type:'box',layout:'vertical',backgroundColor:'#FFFDF9',paddingAll:'20px',contents:body}}};
}

async function projectSelectionMessage(sessionId) {
  const rows=await select('SELECT project_id,project_name FROM projects WHERE active=1 ORDER BY project_name LIMIT 12');
  if(!rows.length)return message('ยังไม่มีโครงการที่เปิดใช้งาน กรุณาเพิ่มโครงการใน WorkHub ก่อน');
  return message('ได้รับรูปครบแล้ว กรุณาเลือกโครงการ',rows.map(row=>postback(clean(row.project_name,20),`action=select_project&session_id=${sessionId}&project_id=${row.project_id}`,`เลือกโครงการ ${clean(row.project_name,40)}`)));
}

async function companySelectionMessage(sessionId) {
  const rows=await select('SELECT company_id,company_name FROM companies WHERE active=1 ORDER BY company_name LIMIT 13');
  if(!rows.length)return message('ยังไม่มีบริษัทที่เปิดใช้งาน กรุณาเพิ่มบริษัทใน WorkHub ก่อน');
  return message('เลือกชื่อบริษัทผู้ซื้อที่บิลควรระบุ',rows.map(row=>postback(clean(row.company_name,20),`action=select_company&session_id=${sessionId}&company_id=${row.company_id}`,`เลือก ${clean(row.company_name,35)}`)));
}

async function lineProfile(userId,source) {
  if(!userId)return {displayName:'LINE User',pictureUrl:''};
  try {
    let path=`/v2/bot/profile/${encodeURIComponent(userId)}`;
    if(source?.groupId)path=`/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(userId)}`;
    else if(source?.roomId)path=`/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(userId)}`;
    const profile=await lineRequest(path);
    return {displayName:clean(profile.displayName||'LINE User',255),pictureUrl:clean(profile.pictureUrl,1000)};
  } catch { return {displayName:'LINE User',pictureUrl:''}; }
}

async function rememberLineUser(userId,profile){if(!userId)return;const timestamp=nowSql();await execute("INSERT INTO line_users (user_id,display_name,picture_url,first_seen_at,last_seen_at) VALUES (:id,:name,:picture,:first,:last) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),picture_url=IF(VALUES(picture_url)<>'',VALUES(picture_url),picture_url),last_seen_at=VALUES(last_seen_at)",{id:userId,name:clean(profile.displayName,255)||'LINE User',picture:clean(profile.pictureUrl,1000),first:timestamp,last:timestamp});}

function thaiLongDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return'-';const[y,m,d]=String(value).split('-').map(Number),date=new Date(Date.UTC(y,m-1,d)),days=['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์'],months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];return`${days[date.getUTCDay()]} ที่ ${d} ${months[m-1]} ${y+543}`;}
function moneyText(value){return number(value).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function resultMark(ok){return ok?'✓ ตรงกัน':'! ไม่ตรง/อ่านไม่พบ';}
function row(label,value,color='#44312A'){return{type:'box',layout:'baseline',spacing:'sm',contents:[{type:'text',text:label,color:'#8C756A',size:'sm',flex:4},{type:'text',text:clean(value,300)||'-',color,weight:'bold',size:'sm',align:'end',wrap:true,flex:7}]};}

function billSavedConfirmation(bill){
  const buttons=config.publicBaseUrl?[{type:'button',style:'secondary',color:'#8F5F42',action:{type:'uri',label:'เปิดและแก้ไขบิล',uri:`${config.publicBaseUrl}/?bill_id=${encodeURIComponent(bill.bill_id)}&edit=1`}}]:[];
  return{type:'flex',altText:`บันทึกบิล ${bill.vendor_name||''} เรียบร้อยแล้ว`,contents:{type:'bubble',header:{type:'box',layout:'vertical',backgroundColor:'#31473A',paddingAll:'20px',contents:[{type:'text',text:'บันทึกบิลเรียบร้อย',color:'#FFFFFF',weight:'bold',size:'xl'},{type:'text',text:'ข้อมูลถูกเพิ่มเข้า WorkHub แล้ว',color:'#DCE9DF',size:'sm',margin:'sm'}]},body:{type:'box',layout:'vertical',backgroundColor:'#FFFDF9',paddingAll:'20px',contents:[row('ชื่อร้าน',bill.vendor_name),row('หมวดของบิล',bill.category_name),row('วันที่',thaiLongDate(bill.document_date)),row('เจ้าของบิล',bill.source_user_name||'ผู้ส่งผ่าน LINE'),row('ยอดสุทธิ',`${moneyText(bill.grand_total)} บาท`)]},...(buttons.length?{footer:{type:'box',layout:'vertical',backgroundColor:'#FFFDF9',paddingAll:'20px',contents:buttons}}:{})}};
}

function billConfirmation(bill) {
  const total=moneyText(bill.grand_total),reasons=clean(bill.review_reasons,1000),dateClear=!/ไม่พบวันที่เอกสารชัดเจน|วันที่.*ไม่ชัด/i.test(reasons),duplicate=/บิลซ้ำ/i.test(reasons);
  const allCompanyChecks=!!bill.company_match&&!!bill.tax_id_match&&!!bill.address_match;
  const buttons=[
    {type:'button',style:'primary',color:'#31473A',action:{type:'postback',label:'ยืนยันบิล',data:`action=confirm_bill&bill_id=${bill.bill_id}`,displayText:'ยืนยันบิลนี้'}},
    ...(config.publicBaseUrl?[{type:'button',style:'secondary',color:'#8F5F42',action:{type:'uri',label:'แก้ไขข้อมูลบิล',uri:`${config.publicBaseUrl}/?bill_id=${encodeURIComponent(bill.bill_id)}&edit=1`}}]:[]),
    {type:'button',style:'secondary',color:'#B84C3F',action:{type:'postback',label:'ยกเลิกบิล',data:`action=cancel_bill&bill_id=${bill.bill_id}`,displayText:'ยกเลิกบิลนี้'}},
  ];
  const verificationColor=bill.needs_review?'#A15A34':'#77703F';
  return {type:'flex',altText:`อ่านบิลแล้ว ${bill.vendor_name||'ไม่ทราบผู้ขาย'} ${total} บาท`,contents:{type:'bubble',size:'mega',header:{type:'box',layout:'vertical',backgroundColor:'#2D211C',paddingAll:'22px',contents:[{type:'text',text:'AI BILL CAPTURE',color:'#E3BE72',weight:'bold',size:'sm'},{type:'text',text:clean(bill.vendor_name,200)||'ไม่ทราบชื่อร้าน',color:'#FFFFFF',weight:'bold',size:'xxl',margin:'md',wrap:true},{type:'text',text:clean(bill.category_name,120)||'ไม่ระบุหมวดหมู่',color:'#E1D4CD',weight:'bold',size:'md',margin:'sm',wrap:true},{type:'text',text:bill.needs_review?'! มีข้อมูลที่ต้องตรวจสอบ':'✓ ข้อมูลสำคัญผ่านการตรวจสอบแล้ว',color:bill.needs_review?'#F4C67A':'#E6D88F',weight:'bold',size:'sm',margin:'lg',wrap:true}]},body:{type:'box',layout:'vertical',backgroundColor:'#FFFDF9',paddingAll:'20px',contents:[
    {type:'text',text:'ข้อมูลที่ AI อ่านได้',color:'#8A4B36',weight:'bold',size:'lg'},
    {type:'separator',margin:'md',color:'#DECBBB'},
    row('โครงการ',bill.project_name),row('บริษัท',bill.company_name),row('หมวดของบิล',bill.category_name),row('วันที่',thaiLongDate(bill.document_date)),
    {type:'box',layout:'vertical',cornerRadius:'18px',backgroundColor:'#F8EADB',paddingAll:'16px',margin:'lg',contents:[row('ก่อน VAT',`${moneyText(bill.subtotal)} บาท`),row('VAT',`${moneyText(bill.vat_amount)} บาท`),{type:'separator',margin:'md',color:'#D9BFA8'},{type:'text',text:'ยอดสุทธิ',color:'#8C756A',weight:'bold',size:'sm',margin:'md'},{type:'text',text:`${total} บาท`,color:'#8A4428',weight:'bold',size:'xxl',align:'end',margin:'sm'}]},
    {type:'text',text:'ผลตรวจสอบข้อมูลบริษัท',color:'#8A4B36',weight:'bold',size:'lg',margin:'xl'},
    row('ชื่อบริษัท',resultMark(bill.company_match),verificationColor),row('เลขผู้เสียภาษี',resultMark(bill.tax_id_match),verificationColor),row('ที่อยู่',resultMark(bill.address_match),verificationColor),row('คุณภาพรูป',`${clean(bill.image_quality,40)||'-'} · ${Math.round(normalizeQualityScore(bill.quality_score))}%`),row('เจ้าของบิล',bill.source_user_name||'ผู้ส่งผ่าน LINE'),row('วันที่ในบิล',dateClear?'✓ ระบุชัดเจน':'! ไม่ชัดเจน ใช้วันที่อัปโหลด',dateClear?'#77703F':'#A15A34'),row('บิลซ้ำ',duplicate?'! พบรายการที่อาจซ้ำ':'✓ ไม่พบ',duplicate?'#A15A34':'#77703F'),
    ...(reasons?[{type:'box',layout:'vertical',cornerRadius:'14px',backgroundColor:allCompanyChecks&&!bill.needs_review?'#F3F0E4':'#FFF0E2',paddingAll:'14px',margin:'lg',contents:[{type:'text',text:reasons,color:'#6E6044',size:'xs',wrap:true}]}]:[]),
  ]},footer:{type:'box',layout:'vertical',backgroundColor:'#FFFDF9',paddingAll:'20px',spacing:'sm',contents:buttons}}};
}

async function cleanupSessionFiles(sessionId) {
  const pages=await select('SELECT file_path FROM line_upload_pages WHERE session_id=:id',{id:sessionId});
  await Promise.all(pages.map(row=>removeFile(row.file_path)));
  await execute('DELETE FROM line_upload_pages WHERE session_id=:id',{id:sessionId});
}

async function processSession(sessionId,userId,contextId,replyToken,source) {
  const session=await requireSession(sessionId,userId,contextId);
  if(number(session.received_pages)!==number(session.expected_pages))throw new Error('จำนวนรูปยังไม่ครบตามที่ระบุ');
  if(!session.project_id||!session.company_id)throw new Error('กรุณาเลือกโครงการและบริษัทให้ครบ');
  if(!config.geminiApiKey){await reply(replyToken,[message('ยังวิเคราะห์ไม่ได้ เพราะ NAS ยังไม่ได้ตั้งค่า GEMINI_API_KEY รูปยังถูกเก็บไว้และเลือกตัวเลือกเดิมซ้ำได้หลังตั้งค่าแล้ว')]);return;}
  await execute("UPDATE upload_sessions SET status='PROCESSING',updated_at=:updated WHERE session_id=:id",{id:sessionId,updated:nowSql()});
  await reply(replyToken,[message('รับข้อมูลครบแล้ว กำลังให้ Gemini อ่านและบีบอัดบิล กรุณารอสักครู่…')]);
  const pages=await select('SELECT * FROM line_upload_pages WHERE session_id=:id ORDER BY page_no',{id:sessionId});
  let billCreated=false;
  try {
    const profile=await lineProfile(userId,source);
    await rememberLineUser(userId,profile);
    const files=await Promise.all(pages.map(async page=>({name:page.file_name,dataUrl:`data:${page.mime_type};base64,${(await readBuffer(page.file_path)).toString('base64')}`})));
    const bill=await submitBillPages({project_id:session.project_id,company_id:session.company_id,expected_pages:session.expected_pages,files,source:'LINE',source_user_id:userId,source_user_name:profile.displayName,source_context_id:contextId});
    billCreated=true;
    await execute("UPDATE upload_sessions SET status='COMPLETED',updated_at=:updated WHERE session_id=:id",{id:sessionId,updated:nowSql()});
    await cleanupSessionFiles(sessionId);
    await pushWithRetry(contextId,[billConfirmation(bill)]);
  } catch(error) {
    if(!billCreated){
      await execute("UPDATE upload_sessions SET status='AWAITING_COMPANY',updated_at=:updated WHERE session_id=:id",{id:sessionId,updated:nowSql()});
      await push(contextId,[message(`วิเคราะห์บิลไม่สำเร็จ: ${clean(error.message,300)}\n\nรูปยังถูกเก็บไว้ พิมพ์ “ยกเลิก” เพื่อเริ่มใหม่ หรือลองเลือกบริษัทอีกครั้งหลังแก้การตั้งค่า`)]).catch(()=>{});
    }
    error.lineNotified=true;
    throw error;
  }
}

async function handleImage(event,userId,contextId) {
  if(!userId)throw new Error('ไม่พบ LINE userId ของผู้ส่งรูป');
  let session=await activeSession(userId,contextId);
  if(session&&['PROCESSING','AWAITING_PROJECT','AWAITING_COMPANY'].includes(session.status)){await reply(event.replyToken,[message('กรุณาทำรายการเดิมให้เสร็จก่อน หรือพิมพ์ “ยกเลิก” เพื่อเริ่มใหม่')]);return;}
  if(!session)session=await createSession(userId,contextId);
  const received=number(session.received_pages),expected=number(session.expected_pages);
  if(expected&&received>=expected){await reply(event.replyToken,[message('ได้รับรูปครบแล้ว กรุณาเลือกโครงการ/บริษัท หรือพิมพ์ “ยกเลิก”')]);return;}
  await saveLineImage(session,clean(event.message.id,160),received+1);
  const next=received+1;
  const status=!expected?'AWAITING_PAGE_COUNT':next>=expected?'AWAITING_PROJECT':'COLLECTING_PAGES';
  await execute('UPDATE upload_sessions SET received_pages=:received,status=:status,updated_at=:updated WHERE session_id=:id',{id:session.session_id,received:next,status,updated:nowSql()});
  if(!expected){await reply(event.replyToken,[pageCountMessage(session.session_id,next,await getQuickSettings())]);return;}
  if(next<expected){await reply(event.replyToken,[message(`ได้รับหน้า ${next}/${expected} แล้ว กรุณาส่งหน้าถัดไป`)]);return;}
  if(session.project_id&&session.company_id)await processSession(session.session_id,userId,contextId,event.replyToken,event.source);
  else await reply(event.replyToken,[await projectSelectionMessage(session.session_id)]);
}

async function handlePostback(event,userId,contextId) {
  const data=Object.fromEntries(new URLSearchParams(clean(event.postback?.data,1000)));
  const action=clean(data.action,80);
  if(action==='cancel_session'){
    const session=await requireSession(data.session_id,userId,contextId);
    await execute("UPDATE upload_sessions SET status='CANCELLED',updated_at=:updated WHERE session_id=:id",{id:session.session_id,updated:nowSql()});
    await cleanupSessionFiles(session.session_id);
    await reply(event.replyToken,[message('ยกเลิกรูปชุดนี้แล้ว ส่งรูปใหม่ได้เลยครับ')]);return;
  }
  if(action==='set_pages'){
    const session=await requireSession(data.session_id,userId,contextId),pages=Math.max(1,Math.min(config.maxPagesPerBill,Number(data.pages)||1));
    if(pages<number(session.received_pages))throw new Error('จำนวนหน้าต้องไม่น้อยกว่ารูปที่ส่งมาแล้ว');
    const ready=number(session.received_pages)>=pages;
    await execute('UPDATE upload_sessions SET expected_pages=:pages,project_id=\'\',company_id=\'\',status=:status,updated_at=:updated WHERE session_id=:id',{id:session.session_id,pages,status:ready?'AWAITING_PROJECT':'COLLECTING_PAGES',updated:nowSql()});
    await reply(event.replyToken,[ready?await projectSelectionMessage(session.session_id):message(`บิลชุดนี้มี ${pages} หน้า\nได้รับแล้ว ${session.received_pages} หน้า กรุณาส่งหน้าถัดไป`)]);return;
  }
  if(action==='use_quick_settings'){
    const session=await requireSession(data.session_id,userId,contextId),quick=(await getQuickSettings()).slots.find(item=>item.slot===Number(data.slot));
    if(!quick?.configured)throw new Error(quick?.message||'ค่าลัดนี้ยังไม่พร้อมใช้งาน');
    if(quick.page_count<number(session.received_pages))throw new Error('จำนวนหน้าในค่าลัดน้อยกว่ารูปที่ส่งมาแล้ว');
    const ready=number(session.received_pages)>=quick.page_count;
    await execute('UPDATE upload_sessions SET expected_pages=:pages,project_id=:project,company_id=:company,status=:status,updated_at=:updated WHERE session_id=:id',{id:session.session_id,pages:quick.page_count,project:quick.project_id,company:quick.company_id,status:ready?'AWAITING_COMPANY':'COLLECTING_PAGES',updated:nowSql()});
    if(ready)await processSession(session.session_id,userId,contextId,event.replyToken,event.source);else await reply(event.replyToken,[message(`ใช้${quick.label} แล้ว\nโครงการ: ${quick.project_name}\nบริษัท: ${quick.company_name}\nได้รับแล้ว ${session.received_pages}/${quick.page_count} หน้า กรุณาส่งหน้าถัดไป`)]);return;
  }
  if(action==='select_project'){
    const session=await requireSession(data.session_id,userId,contextId),project=await one('SELECT project_id FROM projects WHERE project_id=:id AND active=1',{id:clean(data.project_id,64)});
    if(!project)throw new Error('ไม่พบโครงการที่เลือก');
    await execute("UPDATE upload_sessions SET project_id=:project,status='AWAITING_COMPANY',updated_at=:updated WHERE session_id=:id",{id:session.session_id,project:project.project_id,updated:nowSql()});
    await reply(event.replyToken,[await companySelectionMessage(session.session_id)]);return;
  }
  if(action==='select_company'){
    const session=await requireSession(data.session_id,userId,contextId),company=await one('SELECT company_id FROM companies WHERE company_id=:id AND active=1',{id:clean(data.company_id,64)});
    if(!company)throw new Error('ไม่พบบริษัทที่เลือก');
    await execute("UPDATE upload_sessions SET company_id=:company,status='AWAITING_COMPANY',updated_at=:updated WHERE session_id=:id",{id:session.session_id,company:company.company_id,updated:nowSql()});
    await processSession(session.session_id,userId,contextId,event.replyToken,event.source);return;
  }
  if(['confirm_bill','cancel_bill'].includes(action)){
    const bill=await one("SELECT bill_id FROM bills WHERE bill_id=:id AND source='LINE' AND source_user_id=:user AND source_context_id=:context",{id:clean(data.bill_id,64),user:userId,context:contextId});
    if(!bill)throw new Error('ไม่พบบิลนี้ หรือผู้ส่งไม่มีสิทธิ์จัดการ');
    if(action==='confirm_bill'){const saved=await confirmBill(bill.bill_id,userId);await reply(event.replyToken,[billSavedConfirmation(saved)]);}
    else {await deleteBill(bill.bill_id,userId);await reply(event.replyToken,[message('ยกเลิกบิลนี้แล้ว สามารถส่งรูปใหม่ได้เลยครับ')]);}
    return;
  }
  await reply(event.replyToken,[message('คำสั่งหมดอายุหรือไม่ถูกต้อง กรุณาส่งรูปใหม่อีกครั้ง')]);
}

async function cancelSession(userId,contextId) {
  const session=await activeSession(userId,contextId);
  if(!session)return false;
  await execute("UPDATE upload_sessions SET status='CANCELLED',updated_at=:updated WHERE session_id=:id",{id:session.session_id,updated:nowSql()});
  await cleanupSessionFiles(session.session_id);
  return true;
}

async function handleEvent(event) {
  const source=event.source||{},userId=userOf(source),contextId=targetOf(source);
  if(event.type==='message'&&event.message?.type==='image')return handleImage(event,userId,contextId);
  if(event.type==='postback')return handlePostback(event,userId,contextId);
  if(event.type==='message'&&event.message?.type==='text'){
    const text=clean(event.message.text,500);
    if(/^(ยกเลิก|cancel)$/i.test(text)){const cancelled=await cancelSession(userId,contextId);return reply(event.replyToken,[message(cancelled?'ยกเลิกรายการที่กำลังทำแล้ว ส่งรูปใหม่ได้เลยครับ':'ไม่พบรายการที่กำลังทำครับ')]);}
    if(/^(สถานะ|status)$/i.test(text))return reply(event.replyToken,[message(`WorkHub พร้อมรับบิล${config.geminiApiKey?' และ Gemini พร้อมวิเคราะห์':' แต่ยังไม่ได้ตั้งค่า Gemini บน NAS'}\nส่งรูปบิลเพื่อเริ่มใช้งาน`)]);
    return reply(event.replyToken,[message('ส่งรูปบิลเข้ามาได้เลยครับ ระบบจะถามจำนวนหน้า โครงการ และบริษัทก่อนวิเคราะห์\nพิมพ์ “ยกเลิก” เพื่อยกเลิกรายการ')]);
  }
  if(['follow','join'].includes(event.type)&&event.replyToken)return reply(event.replyToken,[message('ยินดีต้อนรับสู่ WorkHub\nส่งรูปบิลเพื่อเริ่มบันทึกค่าใช้จ่ายได้เลยครับ')]);
}

export async function handleLineWebhook(events,logger=console) {
  for(const event of events) {
    const eventId=await reserveEvent(event);
    if(!eventId)continue;
    try { await handleEvent(event); await finishEvent(eventId,'COMPLETED'); }
    catch(error) {
      await finishEvent(eventId,'FAILED',error.message).catch(()=>{});
      logger.error?.({err:error,eventId},'LINE event failed');
      const target=targetOf(event.source);
      if(target&&!error.lineNotified)await push(target,[message(`เกิดข้อผิดพลาด: ${clean(error.message,300)}`)]).catch(()=>{});
    }
  }
}

export async function backfillLineUsernames(){
  const rows=await select("SELECT DISTINCT source_user_id FROM bills WHERE source='LINE' AND source_user_id<>'' ORDER BY source_user_id LIMIT 500");
  let updated=0,skipped=0;
  for(const row of rows){
    const profile=await lineProfile(row.source_user_id,{});
    if(profile.displayName==='LINE User'){skipped+=1;continue;}
    await rememberLineUser(row.source_user_id,profile);
    const result=await execute("UPDATE bills SET source_user_name=:name WHERE source='LINE' AND source_user_id=:id",{id:row.source_user_id,name:profile.displayName});
    updated+=Number(result.affectedRows)||0;
  }
  return{updated,skipped,message:`อัปเดตชื่อผู้ส่งแล้ว ${updated} บิล${skipped?` · อ่านชื่อไม่ได้ ${skipped} คน`:''}`};
}

export { billConfirmation, billSavedConfirmation, pageCountMessage };
