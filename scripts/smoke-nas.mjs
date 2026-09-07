import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';

const endpoint = process.env.WORKHUB_API_URL || 'http://127.0.0.1:18080/api';
const password = process.env.WORKHUB_TEST_PASSWORD || 'test-password';
const deviceId = `smoke-${crypto.randomUUID().replace(/-/g, '')}`;
let sessionToken = '';
let protectedToken = '';

async function call(action, ...args) {
  const requestId = crypto.randomUUID().replace(/-/g, '');
  const response = await fetch(`${endpoint}?requestId=${requestId}`, {
    method:'POST', headers:{'content-type':'text/plain;charset=utf-8'},
    body:JSON.stringify({apiVersion:'2.0',action,args,requestId,sessionToken,protectedToken}),
  });
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error(`${action}: ${result.error?.message}`), { code:result.error?.code });
  return result.data;
}

const health = await call('health');
assert.equal(health.appName, 'WorkHub');
assert.equal(health.modules.expenses, true);

const session = await call('openSession', deviceId);
assert.ok(session.token);
sessionToken = session.token;

const bootstrap = await call('getBootstrapData', {});
assert.equal(bootstrap.app.name, 'WorkHub');
assert.ok(bootstrap.masters.projects.length >= 1);
assert.ok(bootstrap.masters.companies.length >= 1);
assert.ok(bootstrap.masters.categories.length >= 1);
assert.equal(bootstrap.quickSettings.slots.length, 2);

const protectedSession = await call('openProtectedSession', password);
assert.ok(protectedSession.token);
protectedToken = protectedSession.token;

const workspace = await call('getReceiptWorkspace', {});
assert.equal(workspace.enabled, true);
assert.ok(workspace.groups.length >= 1);

const projectName = `ทดสอบ NAS ${Date.now()}`;
const project = await call('saveMasterData', 'project', { project_name:projectName, project_code:'SMOKE', description:'ลบได้' });
assert.equal(project.project_name, projectName);
await call('deleteMasterData', 'project', project.project_id);

const exportResult = await call('exportMonthlyBillExcel', new Date().toISOString().slice(0,7));
assert.match(exportResult.fileName, /\.xlsx$/);
assert.ok(exportResult.sizeBytes > 0);
const chunk = await call('getExportFileChunk', exportResult.downloadToken, 0);
assert.equal(chunk.offset, 0);
assert.ok(chunk.nextOffset > 0);
assert.ok(chunk.base64.length > 0);

const status = await call('getSystemStatus');
assert.match(status.spreadsheet, /^MariaDB /);
assert.equal(status.lineConfigured, false);

const templateZip = new JSZip();
templateZip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
templateZip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{ชื่อสกุล}</w:t></w:r></w:p><w:p><w:r><w:t>{เลขบัตร}</w:t></w:r></w:p><w:p><w:r><w:t>{ที่อยู่}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
templateZip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
const templateBuffer = await templateZip.generateAsync({ type:'nodebuffer' });
const template = await call('saveReceiptTemplate', { template_name:`Smoke ${Date.now()}`, file_name:'smoke.docx', data_url:`data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${templateBuffer.toString('base64')}` });
const group = await call('saveLaborGroup', { group_name:`Smoke group ${Date.now()}`, group_type:'SITE', project_id:bootstrap.masters.projects[0].project_id });
const batch = await call('createReceiptBatch', { template_id:template.template_id, group_id:group.group_id, total_count:1, created_by:'SMOKE' });
const cardColor = `#${Number(Date.now()%0xffffff).toString(16).padStart(6,'0')}`;
const cardBuffer = await sharp({ create:{ width:1200, height:760, channels:3, background:cardColor } }).jpeg({quality:90}).toBuffer();
const firstTwelve = String(Date.now()).slice(-12).padStart(12,'0').replace(/^./,'1');
const checksum = (11 - ([...firstTwelve].reduce((sum,digit,index)=>sum+Number(digit)*(13-index),0) % 11)) % 10;
const nationalId = `${firstTwelve}${checksum}`;
const testPersonName = `สมชาย ทดสอบ${firstTwelve.slice(-6)}`;
const draft = await call('saveReceiptCardDraft', { batch_id:batch.batch_id, file_name:'card.jpg', data_url:`data:image/jpeg;base64,${cardBuffer.toString('base64')}`, ocr:{ full_name:testPersonName, national_id:nationalId, address:'กรุงเทพมหานคร', confidence:99, warnings:[] } });
const saved = await call('saveReceiptRegistrations', { batch_id:batch.batch_id, rows:[{ registration_id:draft.registration_id, full_name:draft.full_name, national_id:draft.national_id, address:draft.address, allow_existing_worker:false }] });
assert.equal(saved.count, 1);
const preview = await call('previewReceiptExport', { registration_ids:[draft.registration_id] });
assert.equal(preview.total, 1);
const receiptDocx = await call('exportReceiptDocuments', { registration_ids:[draft.registration_id], template_id:template.template_id, force_template:true, created_by:'SMOKE' });
const receiptXlsx = await call('exportReceiptRosterExcel', { registration_ids:[draft.registration_id], created_by:'SMOKE' });
assert.match(receiptDocx.fileName, /\.docx$/);
assert.match(receiptXlsx.fileName, /\.xlsx$/);
assert.ok((await call('getExportFileChunk', receiptDocx.downloadToken, 0)).base64.length > 0);

console.log(JSON.stringify({ ok:true, app:health.appName, projects:bootstrap.masters.projects.length, companies:bootstrap.masters.companies.length, categories:bootstrap.masters.categories.length, receiptGroups:workspace.groups.length, exportBytes:exportResult.sizeBytes, receiptDocxBytes:receiptDocx.sizeBytes, receiptXlsxBytes:receiptXlsx.sizeBytes }));
