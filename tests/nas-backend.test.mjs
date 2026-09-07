import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { createReceiptDocx, createXlsx, inspectTemplate } from '../server/exports.mjs';
import { hashPassword, verifyPassword } from '../server/auth.mjs';

const root = path.resolve(import.meta.dirname, '..');

async function templateDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{ชื่อ</w:t></w:r><w:r><w:t>สกุล}</w:t></w:r></w:p><w:p><w:r><w:t>{เลขบัตร}</w:t></w:r></w:p><w:p><w:r><w:t>{ที่อยู่}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return zip.generateAsync({ type:'nodebuffer' });
}

test('NAS deployment artifacts keep secrets out of source and use persistent storage', async () => {
  const [compose, env, dockerfile, schema] = await Promise.all([
    fs.readFile(path.join(root, 'compose.synology.yaml'), 'utf8'),
    fs.readFile(path.join(root, '.env.nas.example'), 'utf8'),
    fs.readFile(path.join(root, 'Dockerfile'), 'utf8'),
    fs.readFile(path.join(root, 'server/migrations/001_init.sql'), 'utf8'),
  ]);
  assert.match(compose, /\/volume1\/docker\/workhub\/data:\/data/);
  assert.match(env, /WORKHUB_PASSWORD_HASH=scrypt\$/);
  assert.doesNotMatch(env, /gfe123456_/);
  assert.match(dockerfile, /USER node/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bills/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS receipt_registrations/);
  assert.match(schema, /INDEX idx_bills_duplicate/);
});

test('scrypt password hashes verify without storing plaintext', async () => {
  const encoded = await hashPassword('test-password');
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('test-password', encoded), true);
  assert.equal(await verifyPassword('wrong-password', encoded), false);
  assert.doesNotMatch(encoded, /test-password/);
});

test('manual XLSX export is a valid OOXML zip', async () => {
  const buffer = await createXlsx('รายการ', ['ชื่อ', 'ยอด'], [['ทดสอบ', 1250.5]], [30, 15]);
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('xl/workbook.xml'));
  assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'), /ทดสอบ/);
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
