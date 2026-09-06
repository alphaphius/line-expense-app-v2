function exportBillsFile(format, filters) {
  let temporarySpreadsheet = null;
  try {
    setupIfNeeded_();
    format = cleanString_(format).toLowerCase();
    if (['xlsx', 'pdf'].indexOf(format) < 0) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
    const rows = getBillsForExport_(filters || {});
    if (!rows.length) throw new Error('ไม่พบบิลในช่วงวันที่หรือตัวกรองที่เลือก');
    if (rows.length > 2000) throw new Error('ส่งออกได้ครั้งละไม่เกิน 2,000 บิล กรุณาเลือกช่วงวันที่ให้แคบลง');

    const timestamp = Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyyMMdd_HHmmss');
    const baseName = 'Bill_Export_' + timestamp;
    temporarySpreadsheet = SpreadsheetApp.create(baseName);
    const reportSheet = temporarySpreadsheet.getSheets()[0];
    reportSheet.setName('Bills');
    writeBillExportSheet_(reportSheet, rows, format === 'pdf');
    if (format === 'xlsx') writeBillItemsExportSheet_(temporarySpreadsheet, rows);
    SpreadsheetApp.flush();

    const exportUrl = format === 'xlsx'
      ? 'https://docs.google.com/spreadsheets/d/' + temporarySpreadsheet.getId() + '/export?format=xlsx'
      : 'https://docs.google.com/spreadsheets/d/' + temporarySpreadsheet.getId() + '/export?format=pdf&gid=' + reportSheet.getSheetId() + '&size=A4&portrait=false&fitw=true&sheetnames=false&printtitle=false&pagenumbers=true&gridlines=false&fzr=true';
    const response = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error('Google สร้างไฟล์ไม่สำเร็จ (HTTP ' + response.getResponseCode() + ')');
    const blob = response.getBlob();
    const extension = format === 'xlsx' ? 'xlsx' : 'pdf';
    const mimeType = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf';
    return ok_(buildExportResult_(blob, baseName + '.' + extension, mimeType, rows.length));
  } catch (error) { return fail_(error); }
  finally {
    if (temporarySpreadsheet) {
      try { DriveApp.getFileById(temporarySpreadsheet.getId()).setTrashed(true); } catch (ignored) { console.error(ignored); }
    }
  }
}

function getBillsForExport_(filters) {
  const projectNames = indexBy_(publicRows_(SHEETS.PROJECTS), 'project_id', 'project_name');
  const companyNames = indexBy_(publicRows_(SHEETS.COMPANIES), 'company_id', 'company_name');
  const categoryNames = indexBy_(publicRows_(SHEETS.CATEGORIES), 'category_id', 'category_name');
  const dateFrom = cleanString_(filters.date_from);
  const dateTo = cleanString_(filters.date_to);
  const rows = publicRows_(SHEETS.BILLS).filter(function (bill) {
    const date = cleanString_(bill.document_date || bill.created_at).slice(0, 10);
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    if (filters.project_id && bill.project_id !== filters.project_id) return false;
    if (filters.company_id && bill.company_id !== filters.company_id) return false;
    if (filters.category_id && bill.category_id !== filters.category_id) return false;
    if (filters.status && bill.status !== filters.status) return false;
    if (!filters.status && bill.status === 'REJECTED') return false;
    return true;
  });
  rows.forEach(function (bill) {
    bill.project_name = projectNames[bill.project_id] || '-';
    bill.company_name = companyNames[bill.company_id] || '-';
    bill.category_name = categoryNames[bill.category_id] || '-';
  });
  return rows.sort(function (a, b) { return cleanString_(a.document_date || a.created_at).localeCompare(cleanString_(b.document_date || b.created_at)); });
}

function writeBillExportSheet_(sheet, bills, compact) {
  const compactFields = [
    ['วันที่', 'document_date'], ['เลขที่เอกสาร', 'document_no'], ['ร้านค้า', 'vendor_name'], ['Tax ID ผู้ขาย', 'vendor_tax_id'],
    ['โครงการ', 'project_name'], ['บริษัท', 'company_name'], ['หมวด', 'category_name'], ['ยอดก่อน VAT', 'subtotal'],
    ['VAT', 'vat_amount'], ['ยอดรวม', 'grand_total'], ['สถานะ', 'status'], ['ผู้ส่ง', 'source_user_id'],
  ];
  const detailFields = compactFields.concat([
    ['ประเภทเอกสาร', 'doc_type'], ['วันครบกำหนด', 'due_date'], ['สาขาผู้ขาย', 'vendor_branch'], ['ที่อยู่ผู้ขาย', 'vendor_address'],
    ['ชื่อผู้ซื้อ', 'buyer_name'], ['Tax ID ผู้ซื้อ', 'buyer_tax_id'], ['ที่อยู่ผู้ซื้อ', 'buyer_address'], ['สกุลเงิน', 'currency'],
    ['ส่วนลด', 'discount'], ['อัตรา VAT', 'vat_rate'], ['ภาษีหัก ณ ที่จ่าย', 'withholding_tax'], ['วิธีชำระ', 'payment_method'],
    ['รายละเอียด', 'description'], ['หมายเหตุ', 'notes'], ['จำนวนหน้า', 'page_count'], ['คุณภาพรูป', 'image_quality'],
    ['คะแนนคุณภาพ', 'quality_score'], ['เหตุผลตรวจสอบ', 'review_reasons'], ['ชื่อบริษัทตรง', 'company_match'], ['Tax ID ตรง', 'tax_id_match'],
    ['ที่อยู่ตรง', 'address_match'], ['ช่องทาง', 'source'], ['วันที่สร้าง', 'created_at'], ['วันที่แก้ไข', 'updated_at'],
    ['วันที่ยืนยัน', 'confirmed_at'], ['Bill ID', 'bill_id'], ['Session ID', 'session_id'], ['Folder', 'folder_path'],
  ]);
  const fields = compact ? compactFields : detailFields;
  const values = [fields.map(function (field) { return field[0]; })].concat(bills.map(function (bill) {
    return fields.map(function (field) { const value = bill[field[1]]; return value == null ? '' : value; });
  }));
  fields.forEach(function (field, index) {
    if (['vendor_tax_id', 'buyer_tax_id'].indexOf(field[1]) >= 0) sheet.getRange(1, index + 1, values.length, 1).setNumberFormat('@');
  });
  sheet.getRange(1, 1, values.length, fields.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, fields.length).setBackground('#064E3B').setFontColor('#FFFFFF').setFontWeight('bold');
  if (values.length > 1) sheet.getRange(2, 8, values.length - 1, compact ? 3 : 3).setNumberFormat('#,##0.00');
  sheet.autoResizeColumns(1, fields.length);
  for (let column = 1; column <= fields.length; column += 1) sheet.setColumnWidth(column, Math.min(220, Math.max(90, sheet.getColumnWidth(column))));
  sheet.getDataRange().setVerticalAlignment('top').setWrap(true);
}

function writeBillItemsExportSheet_(spreadsheet, bills) {
  const billMap = bills.reduce(function (map, bill) { map[bill.bill_id] = bill; return map; }, {});
  const items = publicRows_(SHEETS.ITEMS).filter(function (item) { return !!billMap[item.bill_id]; });
  const sheet = spreadsheet.insertSheet('BillItems');
  const headers = ['Bill ID', 'วันที่', 'เลขที่เอกสาร', 'ร้านค้า', 'ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ส่วนลด', 'VAT', 'ยอดรวม', 'SKU'];
  const values = [headers].concat(items.map(function (item) {
    const bill = billMap[item.bill_id];
    return [item.bill_id, bill.document_date, bill.document_no, bill.vendor_name, item.line_no, item.description, item.quantity, item.unit, item.unit_price, item.discount, item.vat_amount, item.amount, item.sku];
  }));
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#0F766E').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getDataRange().setWrap(true).setVerticalAlignment('top');
  sheet.autoResizeColumns(1, headers.length);
}

function exportMonthlyBillWord(monthKey) {
  try {
    setupIfNeeded_();
    const month = parseExportMonth_(monthKey);
    const bills = getMonthlyExportBills_(month);
    if (!bills.length) throw new Error('ไม่พบบิลในเดือนที่เลือก');
    if (bills.length > 300) throw new Error('Word รองรับสูงสุด 300 บิลต่อครั้ง กรุณาแบ่งช่วงข้อมูล');
    const fileBase = 'รูปบิล_' + month.key;
    const documentsByBill = publicRows_(SHEETS.DOCUMENTS).reduce(function (map, document) {
      if (!map[document.bill_id]) map[document.bill_id] = [];
      map[document.bill_id].push(document);
      return map;
    }, {});
    const packageBlob = buildMonthlyBillDocx_(bills, documentsByBill, fileBase);
    return ok_(buildExportResult_(packageBlob, fileBase + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bills.length, month.key));
  } catch (error) { return fail_(error); }
}

function exportMonthlyBillExcel(monthKey) {
  let temporarySpreadsheet = null;
  try {
    setupIfNeeded_();
    const month = parseExportMonth_(monthKey);
    const bills = getMonthlyExportBills_(month);
    if (!bills.length) throw new Error('ไม่พบบิลในเดือนที่เลือก');
    const fileBase = 'สรุปบิล_' + month.key;
    temporarySpreadsheet = SpreadsheetApp.create(fileBase);
    const sheet = temporarySpreadsheet.getSheets()[0];
    sheet.setName('สรุปบิล');
    writeMonthlyBillExcelSheet_(sheet, bills, month);
    SpreadsheetApp.flush();
    const response = exportGoogleFile_('https://docs.google.com/spreadsheets/d/' + temporarySpreadsheet.getId() + '/export?format=xlsx');
    return ok_(buildExportResult_(response.getBlob(), fileBase + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bills.length, month.key));
  } catch (error) { return fail_(error); }
  finally {
    if (temporarySpreadsheet) {
      try { DriveApp.getFileById(temporarySpreadsheet.getId()).setTrashed(true); } catch (ignored) { console.error(ignored); }
    }
  }
}

function writeMonthlyBillExcelSheet_(sheet, bills, month) {
  const headers = ['ลำดับที่', 'รายการ', 'หมายเหตุ', 'กลุ่มประเภท', 'วันที่ในบิล', 'ราคา', 'ประเภทบิล', 'เจ้าของบิล'];
  const dataStartRow = 3;
  const values = bills.map(function (bill, index) {
    return [index + 1, bill.vendor_name || bill.description || '-', bill.notes || bill.description || '', bill.category_name || '-',
      bill.document_date || '', toNumber_(bill.grand_total), docTypeThai_(bill.doc_type), bill.source_user_id || '-'];
  });
  const totalRow = dataStartRow + values.length;
  sheet.getRange(1, 1, 1, headers.length).merge().setValue('สรุปรายการบิล ประจำเดือน' + thaiMonthYear_(month.year, month.month))
    .setBackground('#2D211C').setFontColor('#F8EEDC').setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(2, 1, 1, headers.length).setValues([headers]).setBackground('#9A6244').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(dataStartRow, 1, values.length, headers.length).setValues(values).setVerticalAlignment('top').setWrap(true);
  sheet.getRange(dataStartRow, 6, values.length, 1).setNumberFormat('#,##0.00');
  sheet.getRange(totalRow, 1, 1, 5).merge().setValue('รวมทั้งหมด').setHorizontalAlignment('right');
  sheet.getRange(totalRow, 6).setFormula('=SUM(F' + dataStartRow + ':F' + (totalRow - 1) + ')').setNumberFormat('#,##0.00');
  sheet.getRange(totalRow, 7, 1, 2).merge().setValue('จำนวน ' + bills.length + ' บิล').setHorizontalAlignment('center');
  sheet.getRange(totalRow, 1, 1, headers.length).setBackground('#4B372F').setFontColor('#FFF8EC').setFontWeight('bold');
  sheet.setFrozenRows(2);
  [70, 240, 280, 150, 130, 120, 150, 170].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
  sheet.getRange(1, 1, totalRow, headers.length).setBorder(true, true, true, true, true, true, '#E7D9CA', SpreadsheetApp.BorderStyle.SOLID);
  return { dataStartRow: dataStartRow, totalRow: totalRow, totalFormula: '=SUM(F' + dataStartRow + ':F' + (totalRow - 1) + ')' };
}

function parseExportMonth_(monthKey) {
  const match = cleanString_(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('รูปแบบเดือนไม่ถูกต้อง');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) throw new Error('เดือนที่เลือกไม่ถูกต้อง');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { key: match[1] + '-' + match[2], year: year, month: month, from: match[1] + '-' + match[2] + '-01', to: match[1] + '-' + match[2] + '-' + String(lastDay).padStart(2, '0') };
}

function getMonthlyExportBills_(month) {
  return getBillsForExport_({ date_from: month.from, date_to: month.to }).filter(function (bill) { return bill.status !== 'REJECTED'; });
}

function thaiMonthYear_(year, month) {
  const names = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return names[month - 1] + ' ' + (year + 543);
}

function buildMonthlyBillDocx_(bills, documentsByBill, fileBase) {
  const packageBlobs = [];
  const relationships = [];
  const imageParts = [];
  let nextRelationshipId = 2;
  let nextDrawingId = 1;
  const bodyParts = [];
  bills.forEach(function (bill, billIndex) {
    bodyParts.push(docxTextParagraph_((billIndex + 1) + '. ' + cleanString_(bill.vendor_name || 'ไม่ทราบร้านค้า'), { size: 28, bold: true, color: '4B372F', after: 60 }));
    const meta = [formatThaiDateLong_(bill.document_date), docTypeThai_(bill.doc_type), formatMoney_(bill.grand_total) + ' บาท'].join('  •  ');
    bodyParts.push(docxTextParagraph_(meta, { size: 18, color: '806D62', after: 120 }));
    const documents = (documentsByBill[bill.bill_id] || []).sort(function (a, b) { return toNumber_(a.page_no) - toNumber_(b.page_no); });
    const images = [];
    const omitted = [];
    documents.slice(0, APP_CONFIG.MAX_PAGES_PER_BILL).forEach(function (document) {
      try {
        const sourceFileId = cleanString_(document.file_id) || extractDriveFileId_(document.file_url);
        if (!sourceFileId) { omitted.push(cleanString_(document.file_url || document.file_name)); return; }
        const sourceBlob = getExportOptimizedBlob_(Object.assign({}, document, { file_id: sourceFileId }));
        const imageType = docxImageType_(sourceBlob.getContentType(), document.file_name);
        if (!imageType) { omitted.push(cleanString_(document.file_url || document.file_name)); return; }
        const imageBytes = sourceBlob.getBytes();
        const relationshipId = 'rId' + nextRelationshipId++;
        const partName = 'image' + (imageParts.length + 1) + '.' + imageType.extension;
        const dimensions = readImageDimensions_(imageBytes, imageType.extension);
        relationships.push('<Relationship Id="' + relationshipId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + partName + '"/>');
        imageParts.push(Utilities.newBlob(imageBytes, imageType.mimeType, 'word/media/' + partName));
        images.push({ relationshipId: relationshipId, drawingId: nextDrawingId++, name: cleanString_(document.file_name || partName), width: dimensions.width, height: dimensions.height });
      } catch (error) {
        console.error('Word export image: ' + error.message);
        omitted.push(cleanString_(document.file_url || document.file_name));
      }
    });
    if (images.length === 1) {
      const fitted = fitDocxImage_(images[0], 6.7, 9.0);
      bodyParts.push(docxImageParagraph_(images[0], fitted.width, fitted.height));
    } else if (images.length > 1) {
      bodyParts.push(docxImageGrid_(images));
    } else {
      bodyParts.push(docxTextParagraph_('ไม่พบรูปภาพที่รองรับสำหรับฝังใน Word', { size: 20, color: 'A55343', after: 120 }));
    }
    omitted.filter(Boolean).forEach(function (url, omittedIndex) {
      bodyParts.push(docxTextParagraph_('เอกสารที่ไม่ได้ฝัง ' + (omittedIndex + 1) + ': ' + url, { size: 16, color: '806D62', after: 40 }));
    });
    if (billIndex < bills.length - 1) bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>' + bodyParts.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="480" w:right="520" w:bottom="480" w:left="520" w:header="240" w:footer="240" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const documentRelationships = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + relationships.join('') + '</Relationships>';
  const rootRelationships = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Prompt" w:hAnsi="Prompt" w:eastAsia="Prompt" w:cs="Prompt"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>';
  packageBlobs.push(Utilities.newBlob(contentTypes, 'application/xml', '[Content_Types].xml'));
  packageBlobs.push(Utilities.newBlob(rootRelationships, 'application/vnd.openxmlformats-package.relationships+xml', '_rels/.rels'));
  packageBlobs.push(Utilities.newBlob(documentXml, 'application/xml', 'word/document.xml'));
  packageBlobs.push(Utilities.newBlob(documentRelationships, 'application/vnd.openxmlformats-package.relationships+xml', 'word/_rels/document.xml.rels'));
  packageBlobs.push(Utilities.newBlob(stylesXml, 'application/xml', 'word/styles.xml'));
  Array.prototype.push.apply(packageBlobs, imageParts);
  return Utilities.zip(packageBlobs, fileBase + '.docx');
}

function extractDriveFileId_(value) {
  const text = cleanString_(value, 2000);
  const match = text.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/i) ||
    text.match(/[?&]id=([A-Za-z0-9_-]{20,})/i) ||
    text.match(/\/d\/([A-Za-z0-9_-]{20,})/i);
  return match ? match[1] : '';
}

function docxTextParagraph_(text, options) {
  options = options || {};
  const runProperties = '<w:rPr><w:rFonts w:ascii="Prompt" w:hAnsi="Prompt" w:eastAsia="Prompt" w:cs="Prompt"/>' +
    (options.bold ? '<w:b/><w:bCs/>' : '') + (options.color ? '<w:color w:val="' + options.color + '"/>' : '') +
    (options.size ? '<w:sz w:val="' + options.size + '"/><w:szCs w:val="' + options.size + '"/>' : '') + '</w:rPr>';
  return '<w:p><w:pPr><w:spacing w:after="' + (options.after == null ? 80 : options.after) + '"/></w:pPr><w:r>' + runProperties + '<w:t xml:space="preserve">' + xmlEscape_(text) + '</w:t></w:r></w:p>';
}

function docxImageGrid_(images) {
  const rows = Math.ceil(images.length / 2);
  const maxHeight = Math.max(1.15, 8.9 / rows);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    const rowCells = [];
    for (let column = 0; column < 2; column += 1) {
      const image = images[row * 2 + column];
      const content = image ? (function () {
        const fitted = fitDocxImage_(image, 3.3, maxHeight);
        return docxImageParagraph_(image, fitted.width, fitted.height);
      })() : '<w:p/>';
      rowCells.push('<w:tc><w:tcPr><w:tcW w:w="5150" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' + content + '</w:tc>');
    }
    cells.push('<w:tr>' + rowCells.join('') + '</w:tr>');
  }
  return '<w:tbl><w:tblPr><w:tblW w:w="10300" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:top w:w="55" w:type="dxa"/><w:left w:w="55" w:type="dxa"/><w:bottom w:w="55" w:type="dxa"/><w:right w:w="55" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="5150"/><w:gridCol w:w="5150"/></w:tblGrid>' + cells.join('') + '</w:tbl>';
}

function docxImageParagraph_(image, widthInches, heightInches) {
  const cx = Math.max(1, Math.round(widthInches * 914400));
  const cy = Math.max(1, Math.round(heightInches * 914400));
  const safeName = xmlEscape_(image.name || ('Bill image ' + image.drawingId));
  return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + image.drawingId + '" name="' + safeName + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + image.drawingId + '" name="' + safeName + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + image.relationshipId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

function fitDocxImage_(image, maxWidth, maxHeight) {
  const width = Number(image.width) || 1;
  const height = Number(image.height) || 1;
  const ratio = width / height;
  let fittedWidth = maxWidth;
  let fittedHeight = fittedWidth / ratio;
  if (fittedHeight > maxHeight) {
    fittedHeight = maxHeight;
    fittedWidth = fittedHeight * ratio;
  }
  return { width: Math.max(0.35, fittedWidth), height: Math.max(0.35, fittedHeight) };
}

function docxImageType_(mimeType, fileName) {
  const mime = cleanString_(mimeType).toLowerCase();
  const name = cleanString_(fileName).toLowerCase();
  if (mime === 'image/jpeg' || /\.jpe?g$/.test(name)) return { extension: 'jpg', mimeType: 'image/jpeg' };
  if (mime === 'image/png' || /\.png$/.test(name)) return { extension: 'png', mimeType: 'image/png' };
  if (mime === 'image/gif' || /\.gif$/.test(name)) return { extension: 'gif', mimeType: 'image/gif' };
  return null;
}

function readImageDimensions_(bytes, extension) {
  function byteAt(index) { return Number(bytes[index]) & 255; }
  if (extension === 'png' && bytes.length >= 24) {
    return {
      width: byteAt(16) * 16777216 + byteAt(17) * 65536 + byteAt(18) * 256 + byteAt(19),
      height: byteAt(20) * 16777216 + byteAt(21) * 65536 + byteAt(22) * 256 + byteAt(23),
    };
  }
  if (extension === 'gif' && bytes.length >= 10) {
    return { width: byteAt(6) + byteAt(7) * 256, height: byteAt(8) + byteAt(9) * 256 };
  }
  if (extension === 'jpg') {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (byteAt(offset) !== 255) { offset += 1; continue; }
      const marker = byteAt(offset + 1);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].indexOf(marker) >= 0) {
        return { height: byteAt(offset + 5) * 256 + byteAt(offset + 6), width: byteAt(offset + 7) * 256 + byteAt(offset + 8) };
      }
      if (marker === 216 || marker === 217) { offset += 2; continue; }
      const segmentLength = byteAt(offset + 2) * 256 + byteAt(offset + 3);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }
  return { width: 3, height: 4 };
}

function xmlEscape_(value) {
  return cleanString_(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function exportGoogleFile_(url) {
  const response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Google สร้างไฟล์ไม่สำเร็จ (HTTP ' + response.getResponseCode() + ')');
  return response;
}

function buildExportResult_(blob, fileName, mimeType, count, periodKey) {
  const safeFileName = cleanString_(fileName, 180);
  if (!safeFileName) throw new Error('ไม่พบชื่อไฟล์ Export');
  const exportBlob = blob.copyBlob().setName(safeFileName).setContentType(mimeType);
  const file = getExportFolder_(periodKey).createFile(exportBlob);
  return buildDriveExportResult_(file, safeFileName, mimeType, count);
}

function getExportFolder_(periodKey) {
  const exportRoot = getOrCreateChildFolder_(getRootFolder_(), APP_CONFIG.EXPORT_FOLDER_NAME || 'exports');
  const folderKey = /^\d{4}-\d{2}$/.test(cleanString_(periodKey)) ? cleanString_(periodKey) : todayIso_().slice(0, 7);
  return getOrCreateChildFolder_(exportRoot, folderKey);
}

function buildDriveExportResult_(file, fileName, mimeType, count) {
  const downloadToken = createExportDownloadTicket_(file, fileName, mimeType);
  return {
    fileName: fileName,
    mimeType: mimeType,
    count: Number(count) || 0,
    sizeBytes: Number(file.getSize()) || 0,
    downloadToken: downloadToken,
    driveUrl: file.getUrl(),
    delivery: 'chunked',
  };
}

function createExportDownloadTicket_(file, fileName, mimeType) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const ticket = {
    fileId: file.getId(),
    fileName: cleanString_(fileName, 180),
    mimeType: cleanString_(mimeType, 180),
    sizeBytes: Number(file.getSize()) || 0,
    createdAt: Date.now(),
  };
  CacheService.getScriptCache().put(exportDownloadCacheKey_(token), JSON.stringify(ticket), APP_CONFIG.EXPORT_TICKET_SECONDS);
  return token;
}

function exportDownloadCacheKey_(token) {
  const safeToken = cleanString_(token, 160);
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(safeToken)) throw new Error('รหัสดาวน์โหลดไม่ถูกต้อง กรุณาสร้างไฟล์ Export ใหม่');
  return 'EXPORT_DOWNLOAD_' + safeToken;
}

function getExportFileChunk(downloadToken, offset) {
  try {
    const cacheKey = exportDownloadCacheKey_(downloadToken);
    const rawTicket = CacheService.getScriptCache().get(cacheKey);
    if (!rawTicket) throw new Error('ลิงก์ดาวน์โหลดหมดอายุ กรุณาสร้างไฟล์ Export ใหม่');
    const ticket = JSON.parse(rawTicket);
    const start = Math.trunc(Number(offset) || 0);
    if (start < 0 || start > ticket.sizeBytes) throw new Error('ตำแหน่งข้อมูลดาวน์โหลดไม่ถูกต้อง');
    if (start === ticket.sizeBytes) {
      return ok_({ offset: start, nextOffset: start, totalBytes: ticket.sizeBytes, base64: '', done: true });
    }

    const chunkBytes = Math.max(256 * 1024, Math.min(Number(APP_CONFIG.EXPORT_CHUNK_BYTES) || 3 * 1024 * 1024, 4 * 1024 * 1024));
    const end = Math.min(ticket.sizeBytes - 1, start + chunkBytes - 1);
    const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(ticket.fileId) + '?alt=media', {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        Range: 'bytes=' + start + '-' + end,
      },
      muteHttpExceptions: true,
    });
    const responseCode = response.getResponseCode();
    if ([200, 206].indexOf(responseCode) < 0) throw new Error('อ่านไฟล์ Export ไม่สำเร็จ (HTTP ' + responseCode + ')');
    let bytes = response.getBlob().getBytes();
    const expectedLength = end - start + 1;
    if (responseCode === 200 && ticket.sizeBytes > expectedLength) {
      if (bytes.length < end + 1) throw new Error('Google Drive ไม่รองรับการอ่านไฟล์เป็นช่วง กรุณาลองใหม่');
      bytes = bytes.slice(start, end + 1);
    } else if (bytes.length > expectedLength) {
      bytes = bytes.slice(0, expectedLength);
    }
    if (!bytes.length) throw new Error('ไม่พบข้อมูลในไฟล์ Export');
    const nextOffset = Math.min(ticket.sizeBytes, start + bytes.length);
    CacheService.getScriptCache().put(cacheKey, rawTicket, APP_CONFIG.EXPORT_TICKET_SECONDS);
    return ok_({
      offset: start,
      nextOffset: nextOffset,
      totalBytes: ticket.sizeBytes,
      base64: Utilities.base64Encode(bytes),
      done: nextOffset >= ticket.sizeBytes,
    });
  } catch (error) { return fail_(error); }
}
