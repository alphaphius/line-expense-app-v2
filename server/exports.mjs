import JSZip from 'jszip';
import sharp from 'sharp';
import { clean, normalizeNationalId } from './utils.mjs';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const xml = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function columnName(index) {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

export async function createXlsx(sheetName, headers, rows, widths = []) {
  const zip = new JSZip();
  const allRows = [headers, ...rows];
  const rowXml = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${rowIndex === 0 ? 1 : 0}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${rowIndex === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Math.min(80, width))}" customWidth="1"/>`).join('')}</cols>` : '';
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2D211C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rowXml}</sheetData><autoFilter ref="A1:${columnName(headers.length - 1)}${allRows.length}"/></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 7 } });
}

function plainText(documentXml) {
  return [...String(documentXml).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')).join('');
}

function replaceOne(documentXml, placeholder, replacement) {
  const nodes = [...String(documentXml).matchAll(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => ({ start: match.index, end: match.index + match[0].length, attrs: match[1] || '', text: match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') }));
  const plain = nodes.map(node => node.text).join('');
  const startOffset = plain.indexOf(placeholder);
  if (startOffset < 0) return documentXml;
  const endOffset = startOffset + placeholder.length;
  let cursor = 0;
  let startNode = -1;
  let endNode = -1;
  let offsetInStart = 0;
  let offsetInEnd = 0;
  nodes.forEach((node, index) => {
    const nodeStart = cursor;
    const nodeEnd = cursor + node.text.length;
    if (startNode < 0 && startOffset >= nodeStart && startOffset < nodeEnd) { startNode = index; offsetInStart = startOffset - nodeStart; }
    if (endNode < 0 && endOffset > nodeStart && endOffset <= nodeEnd) { endNode = index; offsetInEnd = endOffset - nodeStart; }
    cursor = nodeEnd;
  });
  if (startNode < 0 || endNode < 0) return documentXml;
  if (startNode === endNode) nodes[startNode].text = nodes[startNode].text.slice(0, offsetInStart) + replacement + nodes[startNode].text.slice(offsetInEnd);
  else {
    nodes[startNode].text = nodes[startNode].text.slice(0, offsetInStart) + replacement;
    for (let index = startNode + 1; index < endNode; index += 1) nodes[index].text = '';
    nodes[endNode].text = nodes[endNode].text.slice(offsetInEnd);
  }
  let output = '';
  let last = 0;
  nodes.forEach(node => { output += documentXml.slice(last, node.start) + `<w:t${node.attrs}>${xml(node.text)}</w:t>`; last = node.end; });
  return output + documentXml.slice(last);
}

export function replacePlaceholders(documentXml, replacements) {
  let result = documentXml;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    for (let safety = 0; plainText(result).includes(placeholder) && safety < 100; safety += 1) result = replaceOne(result, placeholder, replacement);
  }
  return result;
}

function pageBreak() { return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }

function imageParagraph(relationshipId, drawingId, name, width, height) {
  const maxWidth = 6.7;
  const maxHeight = 9.25;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const cx = Math.round(width * scale * 914400);
  const cy = Math.round(height * scale * 914400);
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="${xml(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${xml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export async function inspectTemplate(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('ไม่พบเนื้อหาเอกสารใน DOCX');
  const documentXml = await part.async('string');
  const text = plainText(documentXml);
  const required = ['{ชื่อสกุล}', '{เลขบัตร}', '{ที่อยู่}'];
  const missing = required.filter(item => !text.includes(item));
  if (missing.length) throw new Error(`Template ขาด Placeholder: ${missing.join(', ')}`);
  const pageBreaks = (documentXml.match(/<w:br\b[^>]*w:type=["']page["'][^>]*\/>/g) || []).length;
  return { placeholders: required, pageCount: Math.max(1, pageBreaks + 1) };
}

export async function createReceiptDocx(templateBuffer, registrations) {
  await inspectTemplate(templateBuffer);
  const zip = await JSZip.loadAsync(templateBuffer);
  let documentXml = await zip.file('word/document.xml').async('string');
  const bodyMatch = documentXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) throw new Error('โครงสร้างเนื้อหา DOCX ไม่ถูกต้อง');
  const bodyXml = bodyMatch[1];
  const sectionMatch = bodyXml.match(/(<w:sectPr\b[\s\S]*?<\/w:sectPr>)\s*$/);
  const sectionXml = sectionMatch ? sectionMatch[1] : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>';
  const templateBody = sectionMatch ? bodyXml.slice(0, sectionMatch.index) : bodyXml;
  const relPath = 'word/_rels/document.xml.rels';
  let rels = zip.file(relPath) ? await zip.file(relPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let contentTypes = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension=["']jpg["']/i.test(contentTypes)) contentTypes = contentTypes.replace('</Types>', '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
  const relIds = [...rels.matchAll(/Id=["']rId(\d+)["']/g)].map(match => Number(match[1]));
  const drawingIds = [...documentXml.matchAll(/<wp:docPr\b[^>]*\bid=["'](\d+)["']/g)].map(match => Number(match[1]));
  let nextRel = (relIds.length ? Math.max(...relIds) : 0) + 1;
  let nextDrawing = (drawingIds.length ? Math.max(...drawingIds) : 0) + 1;
  const bodies = [];
  for (let index = 0; index < registrations.length; index += 1) {
    const row = registrations[index];
    bodies.push(replacePlaceholders(templateBody, {
      '{ชื่อสกุล}': clean(row.full_name, 200), '{เลขบัตร}': normalizeNationalId(row.national_id), '{ที่อยู่}': clean(row.address, 700),
    }));
    bodies.push(pageBreak());
    const image = await sharp(row.cardBuffer).rotate().jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    const metadata = await sharp(image).metadata();
    const relationId = `rId${nextRel++}`;
    const partName = `receipt-card-${index + 1}.jpg`;
    rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${partName}"/></Relationships>`);
    zip.file(`word/media/${partName}`, image);
    bodies.push(imageParagraph(relationId, nextDrawing++, `${clean(row.full_name, 120)} ID card`, (metadata.width || 1000) / 150, (metadata.height || 600) / 150));
    if (index < registrations.length - 1) bodies.push(pageBreak());
  }
  documentXml = documentXml.replace(bodyMatch[0], `<w:body>${bodies.join('')}${sectionXml}</w:body>`);
  zip.file('word/document.xml', documentXml);
  zip.file(relPath, rels);
  zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 7 } });
}

export async function createSimpleBillDocx(title, bills) {
  const zip = new JSZip();
  const paragraphs = [`<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${xml(title)}</w:t></w:r></w:p>`];
  bills.forEach((bill, index) => {
    paragraphs.push(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${index + 1}. ${xml(bill.vendor_name || '-')}</w:t></w:r></w:p>`);
    paragraphs.push(`<w:p><w:r><w:t>วันที่ ${xml(bill.document_date || '-')} | ยอดสุทธิ ${xml(Number(bill.grand_total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }))} บาท</w:t></w:r></w:p>`);
    paragraphs.push(`<w:p><w:r><w:t>หมวด ${xml(bill.category_name || '-')}</w:t></w:r></w:p>`);
    if (index < bills.length - 1) paragraphs.push(pageBreak());
  });
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 7 } });
}
