(function () {
  'use strict';

  function xml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function columnName(index) {
    let value = index + 1;
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function uniqueSheetNames(sheets) {
    const used = new Set();
    return sheets.map((sheet, index) => {
      const base = String(sheet.name || `Sheet ${index + 1}`).replace(/[\\/*?:\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || `Sheet ${index + 1}`;
      let name = base;
      let suffix = 2;
      while (used.has(name.toLowerCase())) {
        const tail = ` (${suffix++})`;
        name = `${base.slice(0, 31 - tail.length)}${tail}`;
      }
      used.add(name.toLowerCase());
      return { ...sheet, name };
    });
  }

  function cell(value, ref, style) {
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${ref}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  function worksheetXml(sheet) {
    const headers = sheet.headers || [];
    const rows = sheet.rows || [];
    const allRows = [headers, ...rows];
    const widths = headers.map((header, column) => {
      const longest = allRows.reduce((max, row) => Math.max(max, String(row[column] == null ? '' : row[column]).length), String(header).length);
      return Math.max(11, Math.min(42, longest + 2));
    });
    const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
    const rowXml = allRows.map((row, rowIndex) => {
      const cells = headers.map((_, columnIndex) => cell(row[columnIndex] == null ? '' : row[columnIndex], `${columnName(columnIndex)}${rowIndex + 1}`, rowIndex === 0 ? 1 : 2)).join('');
      return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ''}>${cells}</row>`;
    }).join('');
    const end = `${columnName(Math.max(0, headers.length - 1))}${Math.max(1, allRows.length)}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${end}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  }

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6F412F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE7D8CC"/></left><right style="thin"><color rgb="FFE7D8CC"/></right><top style="thin"><color rgb="FFE7D8CC"/></top><bottom style="thin"><color rgb="FFE7D8CC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  async function createWorkbook(inputSheets, options) {
    const sheets = uniqueSheetNames(inputSheets || []);
    if (!sheets.length) throw new Error('ไม่มีข้อมูลสำหรับสร้าง Excel');
    const Zip = options?.JSZip || window.JSZip;
    if (!Zip) throw new Error('ยังโหลดตัวสร้าง Excel ไม่สำเร็จ');
    const zip = new Zip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    const xl = zip.folder('xl');
    xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
    xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    xl.file('styles.xml', stylesXml);
    const worksheets = xl.folder('worksheets');
    sheets.forEach((sheet, index) => worksheets.file(`sheet${index + 1}.xml`, worksheetXml(sheet)));
    return zip.generateAsync({ type:options?.outputType || 'blob', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression:'DEFLATE', compressionOptions:{ level:6 } });
  }

  function decodeXml(value) {
    return String(value == null ? '' : value)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function cellColumn(reference) {
    const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
    return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  }

  function parseWorksheet(xmlText, sharedStrings) {
    const rows = [];
    for (const rowMatch of String(xmlText).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const reference = attributes.match(/\br=["']([^"']+)["']/)?.[1] || '';
        const type = attributes.match(/\bt=["']([^"']+)["']/)?.[1] || '';
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? '';
        let value = decodeXml(raw);
        if (type === 's') value = sharedStrings[Number(value)] ?? '';
        else if (!type && value !== '' && Number.isFinite(Number(value))) value = Number(value);
        row[cellColumn(reference)] = value;
      }
      rows.push(row);
    }
    return rows;
  }

  async function parseWorkbook(file, options) {
    const Zip = options?.JSZip || window.JSZip;
    if (!Zip) throw new Error('ยังโหลดตัวอ่าน Excel ไม่สำเร็จ');
    const zip = await Zip.loadAsync(file);
    const workbookPart = zip.file('xl/workbook.xml');
    const relationshipsPart = zip.file('xl/_rels/workbook.xml.rels');
    if (!workbookPart || !relationshipsPart) throw new Error('ไฟล์นี้ไม่ใช่ XLSX ที่รองรับ');
    const workbookXml = await workbookPart.async('string');
    const relationshipsXml = await relationshipsPart.async('string');
    const relationTargets = new Map([...relationshipsXml.matchAll(/<Relationship\b[^>]*\bId=["']([^"']+)["'][^>]*\bTarget=["']([^"']+)["'][^>]*\/?>(?:<\/Relationship>)?/g)].map(match => [match[1], match[2]]));
    const sharedPart = zip.file('xl/sharedStrings.xml');
    const sharedStrings = [];
    if (sharedPart) {
      const sharedXml = await sharedPart.async('string');
      for (const match of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sharedStrings.push([...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1])).join(''));
    }
    const sheets = {};
    for (const match of workbookXml.matchAll(/<sheet\b[^>]*\bname=["']([^"']+)["'][^>]*\br:id=["']([^"']+)["'][^>]*\/?>(?:<\/sheet>)?/g)) {
      const target = relationTargets.get(match[2]);
      if (!target) continue;
      const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      const part = zip.file(normalized);
      if (!part) continue;
      const grid = parseWorksheet(await part.async('string'), sharedStrings);
      const headers = (grid.shift() || []).map(value => String(value == null ? '' : value).trim().toLowerCase());
      sheets[decodeXml(match[1])] = grid.filter(row => row.some(value => String(value ?? '').trim())).map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()])));
    }
    return sheets;
  }

  window.WorkHubReportXlsx = Object.freeze({ createWorkbook, parseWorkbook, parseWorksheet, uniqueSheetNames, worksheetXml });
})();
