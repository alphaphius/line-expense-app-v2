import { execute, one, transaction } from '../db.mjs';
import { apiError, clean, nowSql } from '../utils.mjs';
import { readBuffer, removeFile, safeName, storeBuffer } from '../files.mjs';

const allowedModules = new Set(['tasks', 'payroll', 'reports']);

function moduleKey(value) {
  const key = clean(value, 40).toLowerCase();
  if (!allowedModules.has(key)) throw apiError('INVALID_MODULE', 'ไม่พบส่วนงานที่ต้องการ', 400);
  return key;
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw apiError('INVALID_MODULE_STATE', 'รูปแบบข้อมูลส่วนงานไม่ถูกต้อง', 400);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > 15 * 1024 * 1024) throw apiError('MODULE_STATE_TOO_LARGE', 'ข้อมูลส่วนงานมีขนาดใหญ่เกินไป กรุณาลดขนาดรูปภาพ', 413);
  return json;
}

function parse(row) {
  if (!row) return null;
  return { module:row.module_key, state:JSON.parse(row.state_json), revision:Number(row.revision), updatedAt:row.updated_at };
}

export async function getModuleState(payload = {}, actor = '') {
  const key = moduleKey(payload.module);
  const candidate = payload.initialState && typeof payload.initialState === 'object' ? normalizeState(payload.initialState) : '';
  return transaction(async connection => {
    const [rows] = await connection.execute('SELECT * FROM workhub_module_state WHERE module_key=? FOR UPDATE', [key]);
    if (rows[0]) return parse(rows[0]);
    if (!candidate) return { module:key, state:null, revision:0, updatedAt:'' };
    const now = nowSql();
    await connection.execute('INSERT INTO workhub_module_state (module_key,state_json,revision,updated_by,created_at,updated_at) VALUES (?,?,1,?,?,?)', [key,candidate,clean(actor,160),now,now]);
    return { module:key, state:JSON.parse(candidate), revision:1, updatedAt:now, imported:true };
  });
}

export async function saveModuleState(payload = {}, actor = '') {
  const key = moduleKey(payload.module);
  const json = normalizeState(payload.state);
  const now = nowSql();
  await execute(`INSERT INTO workhub_module_state (module_key,state_json,revision,updated_by,created_at,updated_at)
    VALUES (:key,:json,1,:actor,:now,:now)
    ON DUPLICATE KEY UPDATE state_json=VALUES(state_json),revision=revision+1,updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`,
    { key, json, actor:clean(actor,160), now });
  const row = await one('SELECT module_key,revision,updated_at FROM workhub_module_state WHERE module_key=:key', { key });
  return { module:key, revision:Number(row.revision), updatedAt:row.updated_at };
}

function fileKey(value) {
  const key = clean(value, 220);
  if (!key || !/^[A-Za-z0-9ก-๙_.:@-]+$/.test(key)) throw apiError('INVALID_MODULE_FILE_KEY', 'รหัสไฟล์ไม่ถูกต้อง', 400);
  return key;
}

export async function saveModuleFile(payload = {}, actor = '') {
  const key=moduleKey(payload.module),id=fileKey(payload.fileKey),name=safeName(payload.fileName,'module-file'),mime=clean(payload.mimeType,160)||'application/octet-stream';
  const encoded=String(payload.base64||'').replace(/\s/g,'');
  const buffer=Buffer.from(encoded,'base64');
  if(!buffer.length||buffer.length>15*1024*1024)throw apiError('MODULE_FILE_TOO_LARGE','ไฟล์ต้องมีขนาดไม่เกิน 15 MB',413);
  const old=await one('SELECT file_path FROM workhub_module_files WHERE module_key=:key AND file_key=:id',{key,id});
  const stored=await storeBuffer('templates',name,buffer),now=nowSql();
  await execute(`INSERT INTO workhub_module_files (module_key,file_key,file_name,mime_type,file_path,size_bytes,updated_by,created_at,updated_at)
    VALUES (:key,:id,:name,:mime,:path,:size,:actor,:now,:now)
    ON DUPLICATE KEY UPDATE file_name=VALUES(file_name),mime_type=VALUES(mime_type),file_path=VALUES(file_path),size_bytes=VALUES(size_bytes),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`,
    {key,id,name,mime,path:stored.relative,size:buffer.length,actor:clean(actor,160),now});
  if(old?.file_path&&old.file_path!==stored.relative)await removeFile(old.file_path);
  return {module:key,fileKey:id,fileName:name,mimeType:mime,sizeBytes:buffer.length};
}

export async function getModuleFile(payload = {}) {
  const key=moduleKey(payload.module),id=fileKey(payload.fileKey);
  const row=await one('SELECT * FROM workhub_module_files WHERE module_key=:key AND file_key=:id',{key,id});
  if(!row)return null;
  const buffer=await readBuffer(row.file_path);
  return {module:key,fileKey:id,fileName:row.file_name,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes),base64:buffer.toString('base64')};
}

export async function deleteModuleFile(payload = {}) {
  const key=moduleKey(payload.module),id=fileKey(payload.fileKey);
  const row=await one('SELECT file_path FROM workhub_module_files WHERE module_key=:key AND file_key=:id',{key,id});
  if(!row)return {deleted:false};
  await execute('DELETE FROM workhub_module_files WHERE module_key=:key AND file_key=:id',{key,id});
  await removeFile(row.file_path);
  return {deleted:true};
}
