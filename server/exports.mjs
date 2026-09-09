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

function worksheetXml({ headers, rows, widths = [], moneyColumns = [], totalRowIndex = -1 }) {
  const money = new Set(moneyColumns);
  const allRows = [headers, ...rows];
  const rowXml = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="26" customHeight="1"' : ''}>${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    const isTotal = rowIndex === totalRowIndex + 1;
    const style = rowIndex === 0 ? 1 : isTotal ? (money.has(columnIndex) ? 4 : 3) : money.has(columnIndex) ? 2 : 0;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Math.min(80, width))}" customWidth="1"/>`).join('')}</cols>` : '';
  const filterRows = totalRowIndex >= 0 ? totalRowIndex + 1 : allRows.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rowXml}</sheetData><autoFilter ref="A1:${columnName(headers.length - 1)}${Math.max(1, filterRows)}"/></worksheet>`;
}

async function createWorkbookXlsx(sheets) {
  const zip = new JSZip();
  const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#\,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Tahoma"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="11"/><name val="Tahoma"/><family val="2"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2D211C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E7D8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 7 } });
}

export async function createXlsx(sheetName, headers, rows, widths = []) {
  return createWorkbookXlsx([{ name: sheetName, headers, rows, widths }]);
}

export async function createBillXlsx(rows) {
  const detailHeaders = ['ลำดับ','วันที่เอกสาร','ผู้ขาย','เจ้าของบิล','รายการของ','โครงการ','บริษัท','หมวดหมู่','ยอดก่อน VAT','VAT','หัก ณ ที่จ่าย','ยอดสุทธิ'];
  const detailRows = rows.map((row, index) => [index + 1,row.document_date || '',row.vendor_name || '',row.owner_name || row.source_user_name || 'เว็บแอป',row.item_descriptions || row.description || '',row.project_name || '',row.company_name || '',row.category_name || '',Number(row.subtotal) || 0,Number(row.vat_amount) || 0,Number(row.withholding_tax) || 0,Number(row.grand_total) || 0]);
  const total = rows.reduce((sum, row) => sum + (Number(row.grand_total) || 0), 0);
  detailRows.push(['','','','','','','','รวมทั้งหมด','','','',total]);
  const categories = [...new Set(rows.map(row => clean(row.category_name, 255) || 'ไม่ระบุหมวด'))].sort((a, b) => a.localeCompare(b, 'th'));
  const owners = new Map();
  for (const row of rows) {
    const name = clean(row.owner_name || row.source_user_name, 255) || 'เว็บแอป';
    const current = owners.get(name) || { count:0, total:0, categories:new Map() };
    current.count += 1;
    current.total += Number(row.grand_total) || 0;
    const category = clean(row.category_name, 255) || 'ไม่ระบุหมวด';
    current.categories.set(category, (current.categories.get(category) || 0) + (Number(row.grand_total) || 0));
    owners.set(name, current);
  }
  const summaryHeaders = ['เจ้าของบิล','จำนวนบิล','ยอดรวม',...categories];
  const summaryRows = [...owners.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'th')).map(([name, value]) => [name,value.count,value.total,...categories.map(category => value.categories.get(category) || 0)]);
  summaryRows.push(['รวมทั้งหมด',rows.length,total,...categories.map(category => rows.reduce((sum, row) => sum + ((clean(row.category_name,255) || 'ไม่ระบุหมวด') === category ? Number(row.grand_total) || 0 : 0), 0))]);
  return createWorkbookXlsx([
    { name:'รายการบิล', headers:detailHeaders, rows:detailRows, widths:[8,16,30,28,38,28,34,24,16,14,16,16], moneyColumns:[8,9,10,11], totalRowIndex:detailRows.length - 1 },
    { name:'สรุปตามเจ้าของ', headers:summaryHeaders, rows:summaryRows, widths:[30,12,18,...categories.map(() => 20)], moneyColumns:[2,...categories.map((_, index) => index + 3)], totalRowIndex:summaryRows.length - 1 },
  ]);
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

function imageParagraph(relationshipId, drawingId, name, width, height, limits = {}) {
  const maxWidth = Number(limits.maxWidth) || 6.7;
  const maxHeight = Number(limits.maxHeight) || 9.25;
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

function docParagraph(label, value, options = {}) {
  const thaiFont = '<w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:eastAsia="Tahoma" w:cs="Tahoma" w:hint="cs"/><w:lang w:val="th-TH" w:eastAsia="th-TH" w:bidi="th-TH"/><w:cs/>';
  const labelRun = label ? `<w:r><w:rPr>${thaiFont}<w:b/><w:color w:val="795442"/></w:rPr><w:t>${xml(label)}</w:t></w:r>` : '';
  const valueRun = `<w:r><w:rPr>${thaiFont}${options.bold ? '<w:b/>' : ''}${options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;
  return `<w:p><w:pPr><w:spacing w:after="${options.after || 100}"/></w:pPr>${labelRun}${valueRun}</w:p>`;
}

export async function createSimpleBillDocx(title, bills) {
  const zip = new JSZip();
  const paragraphs = [];
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>';
  let nextRel = 3;
  let nextDrawing = 1;
  for (let billIndex = 0; billIndex < bills.length; billIndex += 1) {
    const bill = bills[billIndex];
    paragraphs.push(docParagraph('', bill.vendor_name || '-', { bold:true, size:32, after:140 }));
    paragraphs.push(docParagraph('วันที่บิล  ', bill.document_date_thai || bill.document_date || '-'));
    paragraphs.push(docParagraph('ยอดสุทธิ  ', `${Number(bill.grand_total || 0).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 })} บาท`));
    paragraphs.push(docParagraph('หมวดหมู่  ', bill.category_name || '-', { after:160 }));
    const documents = Array.isArray(bill.documents) ? bill.documents : [];
    const maxHeight = documents.length > 1 ? Math.max(2.1, 6.4 / documents.length) : 6.4;
    for (let docIndex = 0; docIndex < documents.length; docIndex += 1) {
      const document = documents[docIndex];
      const image = await sharp(document.buffer).rotate().resize({ width:1600, height:1600, fit:'inside', withoutEnlargement:true }).jpeg({ quality:78, mozjpeg:true }).toBuffer();
      const metadata = await sharp(image).metadata();
      const relationId = `rId${nextRel++}`;
      const partName = `bill-${billIndex + 1}-page-${docIndex + 1}.jpg`;
      rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${partName}"/></Relationships>`);
      zip.file(`word/media/${partName}`, image);
      paragraphs.push(imageParagraph(relationId, nextDrawing++, `${clean(bill.vendor_name,120)} page ${docIndex + 1}`, (metadata.width || 1000) / 150, (metadata.height || 1400) / 150, { maxWidth:6.7, maxHeight }));
    }
    if (!documents.length) paragraphs.push(docParagraph('', 'ไม่พบรูปบิลต้นฉบับ'));
    if (billIndex < bills.length - 1) paragraphs.push(pageBreak());
  }
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', rels);
  zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:eastAsia="Tahoma" w:cs="Tahoma" w:hint="cs"/><w:lang w:val="th-TH" w:eastAsia="th-TH" w:bidi="th-TH"/><w:cs/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>');
  zip.file('word/fontTable.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Tahoma"><w:family w:val="swiss"/><w:charset w:val="DE"/></w:font></w:fonts>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 7 } });
}
