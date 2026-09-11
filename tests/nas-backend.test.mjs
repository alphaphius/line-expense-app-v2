import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { createBillXlsx, createReceiptDocx, createSimpleBillDocx, createXlsx, inspectTemplate } from '../server/exports.mjs';
import { hashPassword, verifyPassword } from '../server/auth.mjs';
import crypto from 'node:crypto';
import { billConfirmation, billSavedConfirmation, pageCountMessage, verifyLineSignature } from '../server/line.mjs';
import { addressesMatch, normalizeQualityScore } from '../server/actions/bills.mjs';
import { buildReceiptAiRequest, normalizeReceiptAiResult } from '../server/actions/receipts.mjs';

const root = path.resolve(import.meta.dirname, '..');

async function templateDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{ชื่อ</w:t></w:r><w:r><w:t>สกุล}</w:t></w:r></w:p><w:p><w:r><w:t>{เลขบัตร}</w:t></w:r></w:p><w:p><w:r><w:t>{ที่อยู่}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return zip.generateAsync({ type:'nodebuffer' });
}

test('NAS deployment artifacts keep secrets out of source and use persistent storage', async () => {
  const [compose, env, dockerfile, schema, lineSchema, receiptAiSchema, server, line] = await Promise.all([
    fs.readFile(path.join(root, 'compose.synology.yaml'), 'utf8'),
    fs.readFile(path.join(root, '.env.nas.example'), 'utf8'),
    fs.readFile(path.join(root, 'Dockerfile'), 'utf8'),
    fs.readFile(path.join(root, 'server/migrations/001_init.sql'), 'utf8'),
    fs.readFile(path.join(root, 'server/migrations/002_line_messaging.sql'), 'utf8'),
    fs.readFile(path.join(root, 'server/migrations/004_receipt_ai_ocr.sql'), 'utf8'),
    fs.readFile(path.join(root, 'server/server.mjs'), 'utf8'),
    fs.readFile(path.join(root, 'server/line.mjs'), 'utf8'),
  ]);
  assert.match(compose, /workhub-data:\/data/);
  assert.match(compose, /workhub-data:\s*\n\s+name: workhub-data/);
  assert.match(compose, /network_mode: host/);
  assert.match(compose, /workhub-receipt-ai\.env/);
  assert.match(env, /WORKHUB_PASSWORD_HASH=scrypt\$/);
  assert.doesNotMatch(env, /gfe123456_/);
  assert.match(dockerfile, /USER node/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bills/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS receipt_registrations/);
  assert.match(schema, /INDEX idx_bills_duplicate/);
  assert.match(env, /PUBLIC_BASE_URL=https:\/\/workhub\.nasgfe1\.synology\.me/);
  assert.match(env, /LINE_CHANNEL_SECRET=REPLACE_/);
  assert.match(env, /RECEIPT_GEMINI_API_KEY=REPLACE_/);
  assert.match(receiptAiSchema, /ai_attempts/);
  assert.match(lineSchema, /CREATE TABLE IF NOT EXISTS line_webhook_events/);
  assert.match(lineSchema, /CREATE TABLE IF NOT EXISTS line_upload_pages/);
  assert.match(server, /request\.rawJsonBody/);
  assert.match(server, /\/webhook\/line/);
  assert.match(server, /repairAddressMatchFlags/);
  assert.match(line, /timingSafeEqual/);
  assert.match(line, /INSERT IGNORE INTO line_webhook_events/);
});

test('Gemini Thai-ID batching maps each image and normalizes safe editable fields', () => {
  const request=buildReceiptAiRequest([{buffer:Buffer.from('one')},{buffer:Buffer.from('two')}]);
  assert.equal(request.contents[0].parts.filter(part=>part.inlineData).length,2);
  assert.match(request.contents[0].parts[1].text,/IMAGE_INDEX=1/);
  assert.equal(request.generationConfig.responseMimeType,'application/json');
  const result=normalizeReceiptAiResult({full_name:'นาย ตัวอย่าง นามรอง สาธิตสกุล',national_id:'1 1017 00207 03 0',address:'1/11  ถนนสุขุมวิท  กรุงเทพมหานคร',confidence:.99,warnings:[]});
  assert.equal(result.fullName,'ตัวอย่าง นามรอง สาธิตสกุล');
  assert.equal(result.national,'1101700207030');
  assert.equal(result.confidence,99);
  assert.equal(result.address,'1/11 ถนนสุขุมวิท กรุงเทพมหานคร');
});

test('LINE webhook signature validates the exact raw request body', () => {
  const secret='unit-test-channel-secret',raw='{"events":[]}';
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('base64');
  assert.equal(verifyLineSignature(raw,signature,secret),true);
  assert.equal(verifyLineSignature(raw+' ',signature,secret),false);
  assert.equal(verifyLineSignature(raw,'invalid',secret),false);
});

test('scrypt password hashes verify without storing plaintext', async () => {
  const encoded = await hashPassword('test-password');
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('test-password', encoded), true);
  assert.equal(await verifyPassword('wrong-password', encoded), false);
  assert.doesNotMatch(encoded, /test-password/);
});

test('Gemini quality scores accept both 0-1 and 0-100 scales', () => {
  assert.equal(normalizeQualityScore(1), 100);
  assert.equal(normalizeQualityScore(0.95), 95);
  assert.equal(normalizeQualityScore(95), 95);
  assert.equal(normalizeQualityScore(120), 100);
});

test('Thai company addresses match despite labels, spacing, and Bangkok abbreviations', () => {
  const companyAddress = '151 ถนนนวลจันทร์ แขวงนวลจันทร์ เขตบึงกุ่ม กทม. 10230';
  const electronicBillAddress = 'เลขที่ 151 ถนน นวลจันทร์ แขวงนวลจันทร์ เขตบึงกุ่ม กรุงเทพมหานคร 10230';
  assert.equal(addressesMatch(companyAddress, electronicBillAddress), true);
  assert.equal(addressesMatch(companyAddress, '99 ถนนสุขุมวิท เขตวัฒนา กรุงเทพมหานคร 10110'), false);
});

test('manual XLSX export is a valid OOXML zip', async () => {
  const buffer = await createXlsx('รายการ', ['ชื่อ', 'ยอด'], [['ทดสอบ', 1250.5]], [30, 15]);
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('xl/workbook.xml'));
  assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'), /ทดสอบ/);
});

test('bill XLSX contains detail and owner summary sheets with totals', async () => {
  const buffer=await createBillXlsx([
    {document_date:'2026-09-08',vendor_name:'ร้าน ก',owner_name:'สมชาย',item_descriptions:'น้ำมัน',project_name:'DMR',company_name:'GFE',category_name:'น้ำมัน',subtotal:100,vat_amount:7,withholding_tax:0,grand_total:107},
    {document_date:'2026-09-09',vendor_name:'ร้าน ข',owner_name:'สมชาย',item_descriptions:'ที่พัก',project_name:'DMR',company_name:'GFE',category_name:'ที่พัก',subtotal:200,vat_amount:14,withholding_tax:0,grand_total:214},
  ]);
  const zip=await JSZip.loadAsync(buffer);
  const workbook=await zip.file('xl/workbook.xml').async('string');
  const detail=await zip.file('xl/worksheets/sheet1.xml').async('string');
  const summary=await zip.file('xl/worksheets/sheet2.xml').async('string');
  assert.match(workbook,/รายการบิล/);
  assert.match(workbook,/สรุปตามเจ้าของ/);
  assert.match(detail,/เจ้าของบิล/);
  assert.match(detail,/รายการของ/);
  assert.match(detail,/รวมทั้งหมด/);
  assert.match(summary,/สมชาย/);
  assert.match(summary,/321/);
});

test('bill DOCX includes compressed bill images and omits document numbers', async () => {
  const image=await sharp({create:{width:900,height:1200,channels:3,background:'#f4eee8'}}).jpeg().toBuffer();
  const buffer=await createSimpleBillDocx('',[{vendor_name:'ร้านทดสอบ',document_date:'2026-09-08',document_date_thai:'วันอังคาร ที่ 8 กันยายน 2569',grand_total:190,category_name:'การบริการ',document_no:'SHOULD-NOT-APPEAR',documents:[{buffer:image}]}]);
  const zip=await JSZip.loadAsync(buffer);
  const documentXml=await zip.file('word/document.xml').async('string');
  assert.match(documentXml,/ร้านทดสอบ/);
  assert.match(documentXml,/วันอังคาร ที่ 8 กันยายน 2569/);
  assert.doesNotMatch(documentXml,/SHOULD-NOT-APPEAR/);
  assert.ok(zip.file('word/media/bill-1-page-1.jpg'));
});

test('LINE Flex preserves the legacy visual sections, six-page limit, cancel and direct edit', () => {
  const chooser=JSON.stringify(pageCountMessage('session-1',1,{slots:[{slot:1,label:'ค่าลัด 1',configured:true,page_count:1,project_name:'DMR',company_name:'GFE'}]}));
  assert.match(chooser,/เลือกวิธีรับบิล/);
  assert.match(chooser,/ยกเลิกรูปนี้/);
  assert.match(chooser,/6 หน้า/);
  assert.doesNotMatch(chooser,/7 หน้า|8 หน้า/);
  const flex=JSON.stringify(billConfirmation({bill_id:'bill-1',vendor_name:'ร้านทดสอบ',category_name:'การบริการ',project_name:'DMR',company_name:'GFE',document_date:'2026-09-08',subtotal:190,vat_amount:0,grand_total:190,company_match:true,tax_id_match:true,address_match:true,image_quality:'CLEAR',quality_score:95,source_user_name:'Fiat Taksakorn',needs_review:false,review_reasons:''}));
  assert.match(flex,/AI BILL CAPTURE/);
  assert.match(flex,/ผลตรวจสอบข้อมูลบริษัท/);
  assert.match(flex,/Fiat Taksakorn/);
  const normalizedFlex=JSON.stringify(billConfirmation({bill_id:'bill-2',vendor_name:'ร้านทดสอบ',category_name:'การบริการ',project_name:'DMR',company_name:'GFE',document_date:'2026-09-08',subtotal:190,vat_amount:0,grand_total:190,company_match:true,tax_id_match:true,address_match:true,image_quality:'CLEAR',quality_score:1,source_user_name:'Fiat Taksakorn',needs_review:false,review_reasons:''}));
  assert.match(normalizedFlex,/CLEAR · 100%/);
  const savedFlex=JSON.stringify(billSavedConfirmation({bill_id:'bill-1',vendor_name:'ร้านทดสอบ',category_name:'การบริการ',document_date:'2026-09-08',grand_total:190,source_user_name:'Fiat Taksakorn'}));
  assert.match(savedFlex,/บันทึกบิลเรียบร้อย/);
  assert.match(savedFlex,/เจ้าของบิล/);
  assert.match(savedFlex,/Fiat Taksakorn/);
  assert.doesNotMatch(flex,/เลขที่เอกสาร|document_no/);
});

test('receipt DOCX clones templates, replaces split placeholders, and adds compressed cards', async () => {
  const template = await templateDocx();
  assert.deepEqual((await inspectTemplate(template)).placeholders, ['{ชื่อสกุล}', '{เลขบัตร}', '{ที่อยู่}']);
  const cardBuffer = await sharp({ create:{ width:1200, height:760, channels:3, background:'#eee7dd' } }).jpeg().toBuffer();
  const result = await createReceiptDocx(template, [{ full_name:'สมชาย ทดสอบ', national_id:'1234567890123', address:'กรุงเทพมหานคร', cardBuffer }]);
  const zip = await JSZip.loadAsync(result);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /สมชาย ทดสอบ/);
  assert.doesNotMatch(documentXml, /\{ชื่อสกุล\}/);
  assert.ok(zip.file('word/media/receipt-card-1.jpg'));
});
