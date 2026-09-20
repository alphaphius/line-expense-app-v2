import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import JSZip from 'jszip';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFile(path.join(root, file), 'utf8');

async function loadCore() {
  const context = vm.createContext({ window:{}, Date, Intl, Math, Number, String, Array, Object, RegExp });
  new vm.Script(await read('frontend/workhub-core.js'), { filename:'workhub-core.js' }).runInContext(context);
  return context.window.WorkHubCore;
}

async function loadReportsCore() {
  const context = vm.createContext({ window:{}, Date, Intl, Math, Number, String, Array, Object, RegExp, Map, Set });
  new vm.Script(await read('frontend/reports.js'), { filename:'reports.js' }).runInContext(context);
  return context.window.ReportManagerModule;
}

test('weekly payroll always runs Monday through Sunday and supports half-hour OT', async () => {
  const core = await loadCore();
  const dates = Array.from(core.weekDates('2026-09-17'));
  assert.deepEqual(dates, ['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']);
  const workers = [{ id:'w1', groupId:'g1', dailyRate:450, otRate:50, rateHistory:[] }];
  const attendance = {
    '2026-09-14:w1':{ status:'present', ot:2 },
    '2026-09-15:w1':{ status:'present', ot:1.5 },
    '2026-09-16:w1':{ status:'absent', ot:4 },
  };
  const result = core.weeklyPayroll(workers, attendance, dates, 'g1');
  assert.equal(result.rows[0].workDays, 2);
  assert.equal(result.rows[0].wages, 900);
  assert.equal(result.rows[0].otHours, 3.5);
  assert.equal(result.rows[0].otPay, 175);
  assert.equal(result.rows[0].total, 1075);
});

test('effective-dated wage history is used without rewriting older weeks', async () => {
  const core = await loadCore();
  const worker = { dailyRate:400, otRate:50, rateHistory:[
    { effectiveDate:'2026-09-21', dailyRate:500, otRate:60 },
    { effectiveDate:'2026-01-01', dailyRate:450, otRate:50 },
  ] };
  assert.equal(core.rateAt(worker, '2026-09-20', 'dailyRate'), 450);
  assert.equal(core.rateAt(worker, '2026-09-21', 'dailyRate'), 500);
  assert.equal(core.rateAt(worker, '2026-09-21', 'otRate'), 60);
});

test('approved Task Manager contains only notes, equipment tracking, and planning', async () => {
  const [html, tasks] = await Promise.all([read('frontend/index.html'), read('frontend/tasks.js')]);
  assert.match(html, /id="task-manager-root"/);
  assert.match(tasks, /บันทึกการพูดคุย/);
  assert.match(tasks, /ติดตามอุปกรณ์/);
  assert.match(tasks, /แผนงาน/);
  assert.match(tasks, /data-gantt-bar/);
  assert.match(tasks, /S\/N .*ถูกลงทะเบียนแล้ว/);
  assert.doesNotMatch(tasks, /ทีมและบุคลากร|CRM|อนุมัติ/);
});

test('payroll provides group bulk attendance, half-hour OT, weekly totals and separate exports', async () => {
  const [html, payroll] = await Promise.all([read('frontend/index.html'), read('frontend/payroll.js')]);
  assert.match(html, /id="payroll-root"/);
  assert.match(payroll, /มาทั้งกลุ่ม/);
  assert.match(payroll, /ไม่มาทั้งกลุ่ม/);
  assert.match(payroll, /\[0,\.5,1,1\.5,2,3,4\]/);
  assert.match(payroll, /core\(\)\.weekDates/);
  assert.match(payroll, /ดาวน์โหลด PDF/);
  assert.match(payroll, /ดาวน์โหลด Excel/);
  assert.match(payroll, /@page\{size:A4 landscape/);
  assert.match(payroll, /row\.days\.map/);
  assert.match(payroll, /sheetXml/);
  assert.doesNotMatch(payroll, /ปรับเพิ่ม\/ลด/);
});

test('all module dialog cancel controls bypass required-field validation', async () => {
  const [tasks, payroll, reports] = await Promise.all([read('frontend/tasks.js'), read('frontend/payroll.js'), read('frontend/reports.js')]);
  for (const source of [tasks, payroll, reports]) {
    assert.match(source, /querySelectorAll\('button\[value="cancel"\]'\)/);
    assert.match(source, /button\.type='button'/);
    assert.match(source, /button\.addEventListener\('click',\(\)=>dialog\.close\(\)\)/);
  }
});

test('build and offline shell include all local-test modules', async () => {
  const [build, worker] = await Promise.all([read('scripts/build.mjs'), read('frontend/service-worker.js')]);
  for (const asset of ['workhub-core.js','module-store.js','tasks.js','payroll.js','report-xlsx.js','reports.js','workhub-modules.css']) {
    assert.match(build, new RegExp(asset.replace('.', '\\.')));
    assert.match(worker, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(build, /jszip\.min\.js/);
  assert.match(build, /markerclusterer\.umd\.js/);
  assert.match(worker, /markerclusterer\.umd\.js/);
});

test('bill owner checkbox selection drives both list filters and exports', async () => {
  const [html, app, masters, bills, preview] = await Promise.all([
    read('frontend/index.html'), read('frontend/app.js'), read('server/actions/masters.mjs'),
    read('server/actions/bills.mjs'), read('scripts/dev-server.mjs'),
  ]);
  assert.match(html, /id="bill-owner-filter-options"/);
  assert.match(html, /id="bill-owner-select-all"/);
  assert.match(html, /id="bill-owner-clear"/);
  assert.match(app, /owner_ids:\s*selectedBillOwnerIds\(\)/);
  assert.match(app, /function exportSelection\(\)/);
  assert.match(app, /เจ้าของบิล:/);
  assert.match(app, /ไม่มีบิลสำหรับ Export/);
  assert.match(masters, /Array\.isArray\(filters\.owner_ids\)/);
  assert.match(bills, /Array\.isArray\(selection\.owner_ids\)/);
  assert.match(preview, /function filterMockBills/);
  assert.match(preview, /filters\.owner_ids\.includes\(row\.source_user_id\)/);
});

test('secondary navigation exposes protected Main App, Stock App, Database, and Reports access', async () => {
  const [html, app, css, preview] = await Promise.all([
    read('frontend/index.html'), read('frontend/app.js'), read('frontend/styles.css'), read('scripts/dev-server.mjs'),
  ]);
  assert.match(html, /class="resource-nav"/);
  assert.match(html, /data-external-url="https:\/\/app\.nasgfe1\.synology\.me\/"/);
  assert.match(html, /data-external-url="https:\/\/inv\.nasgfe1\.synology\.me\/login"/);
  assert.match(html, /data-database-url="http:\/\/nasgfe1\.synology\.me\/phpmyadmin\/index\.php\?route=\/"/);
  assert.match(html, /id="view-reports"/);
  assert.match(html, /id="report-manager-root"/);
  assert.match(html, /id="expense-subnav"/);
  assert.match(html, /id="external-link-sheet"/);
  assert.match(app, /protectedViews = \['receipts','payroll','tasks','reports'\]/);
  assert.match(app, /ProtectedAccess\.ensure\(\)/);
  assert.match(app, /expense-subnav.*expenseViews\.indexOf\(view\) < 0/);
  assert.match(css, /\.resource-nav\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(preview, /action === 'verifyDatabaseAccess'/);
});

test('desktop sidebar can collapse, restore, and remember the user preference', async () => {
  const [html, app, css] = await Promise.all([
    read('frontend/index.html'), read('frontend/app.js'), read('frontend/styles.css'),
  ]);
  assert.match(html, /id="sidebar-toggle"/);
  assert.match(html, /aria-controls="app-sidebar"/);
  assert.match(html, /class="sidebar-brand-copy/);
  assert.match(html, /class="header-gfe-logo"/);
  assert.match(html, /class="sidebar-mode-nav"/);
  assert.equal((html.match(/class="sidebar-mode-icon"/g)||[]).length, 8);
  assert.equal((html.match(/data-tooltip=/g)||[]).length, 8);
  assert.match(app, /workhub\.desktopSidebarCollapsed/);
  assert.match(app, /function setDesktopSidebarCollapsed/);
  assert.match(app, /initializeDesktopSidebar\(\)/);
  assert.match(app, /is-bouncing/);
  assert.match(css, /body\.sidebar-collapsed \.app-sidebar/);
  assert.match(css, /body\.sidebar-collapsed \.app-main/);
  assert.match(css, /width:84px !important/);
  assert.match(css, /width:calc\(100vw - 84px\) !important/);
  assert.match(css, /width:calc\(100vw - 18rem\) !important/);
  assert.match(css, /max-width:none !important/);
  assert.match(css, /transform:rotate\(-90deg\)/);
  assert.match(css, /content:attr\(data-tooltip\)/);
  assert.match(css, /@keyframes sidebar-fluid/);
  assert.match(css, /bottom:28px/);
  assert.match(css, /@media \(min-width:1024px\)/);
});

test('reports support reusable templates, site-scoped equipment IDs, CSV imports, favorites, and hierarchical export selection', async () => {
  const [reports, styles] = await Promise.all([read('frontend/reports.js'), read('frontend/workhub-modules.css')]);
  assert.match(reports, /workhub-installation-reports-v2/);
  assert.match(reports, /async function scanTemplate/);
  assert.match(reports, /image=\/\^img_\/i\.test\(fieldKey\)/);
  assert.match(reports, /'eq-a-sm1'.*id:'SM1'/s);
  assert.match(reports, /'eq-a-sm2'.*id:'SM2'/s);
  assert.match(reports, /'eq-a-sm3'.*id:'SM3'/s);
  assert.match(reports, /e\.siteId===site\.uid&&e\.id===row\.equipment_id/);
  assert.match(reports, /data-report-site-check/);
  assert.match(reports, /data-report-type-site/);
  assert.match(reports, /data-report-template-select/);
  assert.match(reports, /active:'reports'/);
  assert.match(reports, /reportStep:'groups'/);
  assert.match(reports, /data-report-group-open/);
  assert.match(reports, /data-report-site-open/);
  assert.match(reports, /favorites:\{groupId:'',siteIds:\[\]\}/);
  assert.match(reports, /data-favorite-group/);
  assert.match(reports, /data-favorite-site/);
  assert.match(reports, /function updateReportTabCue/);
  assert.match(reports, /report-tabs-scroll-cue/);
  assert.match(reports, /<details class="report-province/);
  assert.match(reports, /report-province--favorites/);
  assert.match(reports, /state\.reportStep='sites'/);
  assert.match(reports, /report-sites-toolbar/);
  assert.doesNotMatch(reports, /class="report-flow"/);
  assert.doesNotMatch(reports, /จัดการ Template กลุ่มงาน ไซต์ และอุปกรณ์หลายตัว พร้อมติดตามความครบถ้วนก่อน Export/);
  assert.match(reports, /siteMapPanel\(site,equipment\)/);
  assert.match(reports, /report-group-overall/);
  assert.match(reports, /report-province-progress/);
  assert.match(reports, /data-template-delete/);
  assert.match(reports, /data-group-delete/);
  assert.match(reports, /data-site-delete/);
  assert.match(reports, /data-equipment-delete/);
  assert.match(reports, /ProtectedAccess\?\.reauthenticate/);
  assert.match(reports, /GOOGLE_MAPS_API_KEY/);
  assert.match(reports, /AdvancedMarkerElement/);
  assert.match(reports, /markerClusterer\?\.MarkerClusterer/);
  assert.match(reports, /data-province-filter/);
  assert.match(reports, /data-provinces-none/);
  assert.match(reports, /provinceFilterExplicit:false/);
  assert.match(reports, /provinceFilterOpen=true/);
  assert.match(reports, /data-hide-completed-sites/);
  assert.match(reports, /report-group-sites-map/);
  assert.match(reports, /function browserLocation/);
  assert.match(reports, /ระบบจะเริ่มที่ My Location/);
  assert.match(reports, /mapTypeId:'satellite'/);
  assert.match(reports, /function addMyLocationControl/);
  assert.match(reports, /ตำแหน่งฉัน/);
  assert.match(reports, /google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.match(reports, /travelmode=driving/);
  assert.match(reports, /นำทางด้วย Google Maps/);
  assert.match(reports, /function fitMapToPositions/);
  assert.match(reports, /report-map-list-layout--sites/);
  assert.match(reports, /report-map-list-layout--equipment/);
  assert.match(reports, /data-export-all-data/);
  assert.match(reports, /function allDataSheets/);
  assert.match(reports, /WorkHubReportXlsx\.createWorkbook/);
  assert.match(reports, /data-field-drag/);
  assert.match(reports, /data-field-move/);
  assert.match(reports, /row\.latitude\|\|row\.lat\|\|row\.n/);
  assert.match(reports, /headers:\['work_group_id','site_id','site_name','description','map_pin_text'/);
  assert.match(reports, /1 Text Box = 1 รูป/);
  assert.match(reports, /IndexedDB|indexedDB/);
  assert.match(reports, /policy==='blank'/);
  assert.match(reports, /policy==='overwrite'/);
  assert.match(styles, /\.report-tabs::-webkit-scrollbar\{display:block/);
  assert.match(styles, /\.report-shell \[data-csv-import\]\{display:grid!important;width:36px!important/);
  assert.match(styles, /border:0!important;border-radius:0!important;background:transparent!important/);
  assert.match(styles, /\.report-province:not\(\[open\]\)/);
  assert.match(styles, /\.workhub-map-location\{/);
  assert.match(styles, /\.workhub-map-info a\{/);
  assert.match(styles, /\.report-map-list-layout\{display:grid/);
  assert.match(styles, /height:clamp\(520px,calc\(100vh - 310px\),720px\)/);
  assert.match(styles, /\.field-drag-handle\{/);
  assert.match(styles, /\.report-shell\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.report-journey-site>\.report-favorite-button\{position:absolute;top:-11px/);
});

test('report all-data XLSX creates readable sheets with frozen filtered headers', async () => {
  const context = vm.createContext({ window:{ JSZip }, String, Number, Boolean, Math, Object, Array, Set, Map, Error });
  new vm.Script(await read('frontend/report-xlsx.js'), { filename:'report-xlsx.js' }).runInContext(context);
  const sheets = [
    { name:'Soil Moisture Sensor', headers:['Site ID','Equipment ID','ชื่อไซต์','ค่าที่วัด {reading}'], rows:[['SITE-A','SM1','ไซต์ A',12.5],['SITE-A','SM2','ไซต์ A',14]] },
    { name:'Omnia/Datalogger:*?', headers:['Site ID','Equipment ID'], rows:[['SITE-A','DL1']] },
  ];
  const buffer = await context.window.WorkHubReportXlsx.createWorkbook(sheets, { JSZip, outputType:'nodebuffer' });
  const archive = await JSZip.loadAsync(buffer);
  const workbook = await archive.file('xl/workbook.xml').async('string');
  const firstSheet = await archive.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(workbook, /Soil Moisture Sensor/);
  assert.match(workbook, /Omnia Datalogger/);
  assert.match(firstSheet, /state="frozen"/);
  assert.match(firstSheet, /<autoFilter ref="A1:D3"\/>/);
  assert.match(firstSheet, /ค่าที่วัด \{reading\}/);
  assert.match(firstSheet, /<c r="D2" s="2" t="n"><v>12\.5<\/v><\/c>/);
});

test('bulk XLSX reader round-trips Groups, Sites, and Equipment sheets', async () => {
  const context = vm.createContext({ window:{ JSZip }, String, Number, Boolean, Math, Object, Array, Set, Map, Error });
  new vm.Script(await read('frontend/report-xlsx.js'), { filename:'report-xlsx.js' }).runInContext(context);
  const source = [
    { name:'Groups', headers:['work_group_id','work_group_name'], rows:[['FY2569','ปีงบประมาณ 2569']] },
    { name:'Sites', headers:['work_group_id','site_id','description'], rows:[['FY2569','SITE-A','งานติดตั้ง']] },
    { name:'Equipment', headers:['work_group_id','site_id','equipment_id'], rows:[['FY2569','SITE-A','SM1']] },
  ];
  const buffer = await context.window.WorkHubReportXlsx.createWorkbook(source, { JSZip, outputType:'nodebuffer' });
  const sheets = await context.window.WorkHubReportXlsx.parseWorkbook(buffer, { JSZip });
  assert.equal(sheets.Groups[0].work_group_id, 'FY2569');
  assert.equal(sheets.Sites[0].description, 'งานติดตั้ง');
  assert.equal(sheets.Equipment[0].equipment_id, 'SM1');
});

test('Daily Report supports date and site entry, quantities, quick-edit details, template assignment, and XLSX export', async () => {
  const [reports, styles] = await Promise.all([read('frontend/reports.js'), read('frontend/workhub-modules.css')]);
  assert.match(reports, /data-report-tab="daily"/);
  assert.match(reports, /function renderDailyReports/);
  assert.match(reports, /dailyReports:\{\},dailyTemplates:\[\],dailyTemplateAssignments:\{\}/);
  assert.match(reports, /\['engineer','วิศวกร'\]/);
  assert.match(reports, /\['drillingRig','เครื่องเจาะดิน'\]/);
  assert.match(reports, /08:00-17:00/);
  assert.match(reports, /data-daily-detail-add/);
  assert.match(reports, /data-daily-detail-row/);
  assert.match(reports, /RemarkDescp/);
  assert.match(reports, /QtyMachine/);
  assert.match(reports, /daily-template::/);
  assert.match(reports, /data-daily-site=/);
  assert.match(reports, /data-daily-delete/);
  assert.match(styles, /\.daily-calendar-strip/);
  assert.match(styles, /\.daily-qty-grid/);
  assert.match(styles, /\.daily-sticky-actions/);
});

test('Daily Report replacements preserve ordered items and blank every unused placeholder', async () => {
  const reports = await loadReportsCore();
  const replacements = reports.dailyReplacements({
    date:'2026-09-15',
    people:{ engineer:{ label:'วิศวกร', qty:2 }, civilTech:{ label:'ช่างโยธา', qty:0 }, labor:{ label:'แรงงาน', qty:5 }, geologist:{ label:'นักธรณี', qty:0 } },
    machines:{ drillingRig:{ label:'เครื่องเจาะดิน', qty:1 }, crane:{ label:'รถเครน', qty:0 }, tenWheelTruck:{ label:'รถบรรทุกสิบล้อ', qty:0 }, excavator:{ label:'รถขุดดิน', qty:0 } },
    details:[{ description:'ติดตั้ง Sensor', remark:'DONE', time:'08:00-12:00' }],
  }, { id:'SITE-A', name:'ไซต์ A', description:'งานทดสอบ', mapPinText:'SITE-A Pin', moo:'4', village:'บ้านทดสอบ', subdistrict:'บางปะกง', district:'บางปะกง', province:'ฉะเชิงเทรา' });
  assert.equal(replacements['{Person1}'], 'วิศวกร');
  assert.equal(replacements['{Person2}'], 'แรงงาน');
  assert.equal(replacements['{QtyMachine1}'], 1);
  assert.equal(replacements['{Description1}'], 'ติดตั้ง Sensor');
  assert.equal(replacements['{RemarkDescp1}'], 'ดำเนินการแล้วเสร็จ');
  assert.equal(replacements['{Description10}'], '');
  assert.equal(replacements['{Machine4}'], '');
});

test('report site records use Description, structured Thai address, map Pin text, and searchable views', async () => {
  const reports = await read('frontend/reports.js');
  assert.match(reports, /site\.description=site\.description\|\|site\.customer/);
  assert.match(reports, /name="mapPinText"/);
  assert.match(reports, /name="moo"/);
  assert.match(reports, /name="village"/);
  assert.match(reports, /name="subdistrict"/);
  assert.match(reports, /name="district"/);
  assert.match(reports, /data-report-global-search/);
  assert.match(reports, /data-bulk-xlsx/);
  assert.match(reports, /Groups.*Sites.*Equipment/s);
  assert.match(reports, /site\.mapPinText\|\|site\.name/);
});

test('destructive report actions always re-enter the protected password', async () => {
  const [access, reports] = await Promise.all([read('frontend/protected-access.js'), read('frontend/reports.js')]);
  assert.match(access, /async function reauthenticate/);
  assert.match(access, /unlockProtected\(password\)/);
  assert.match(access, /confirmButtonText: destructive \? 'ยืนยันลบ'/);
  assert.match(reports, /authorizeDelete/);
  assert.match(reports, /deleteEquipmentRecords/);
});

test('report coordinates accept N/E and lat/long decimal columns', async () => {
  const reports = await loadReportsCore();
  const ne = reports.coordinatesFromRow({ n:'13.7563', e:'100.5018' });
  const latLong = reports.coordinatesFromRow({ lat:'13.7', long:'100.4' });
  assert.equal(ne.latitude, 13.7563);
  assert.equal(ne.longitude, 100.5018);
  assert.equal(latLong.latitude, 13.7);
  assert.equal(latLong.longitude, 100.4);
  assert.equal(reports.normalizeCoordinate('181', 'lng'), '');
});

test('reports replace split DOCX and XLSX text placeholders without changing the file layout nodes', async () => {
  const reports = await loadReportsCore();
  const docx = '<w:p><w:r><w:t>{site_</w:t></w:r><w:r><w:t>name}</w:t></w:r></w:p>';
  const xlsx = '<xdr:sp><a:p><a:r><a:t>{equipment_</a:t></a:r><a:r><a:t>id}</a:t></a:r></a:p></xdr:sp>';
  assert.match(reports.replaceXmlPlaceholders(docx, {'{site_name}':'ไซต์ A & B'}, 'DOCX'), /ไซต์ A &amp; B/);
  assert.match(reports.replaceXmlPlaceholders(xlsx, {'{equipment_id}':'SM1'}, 'XLSX'), /SM1/);
});

test('report template fields accept Thai, spaces, commas, and image textbox names', async () => {
  const reports = await loadReportsCore();
  const fields = reports.collectTemplateFields([
    '{Site Code} {ที่อยู่} {อุณหภูมิค่าอ่านเริ่มต้น,mA}',
    '{img_รูปภาพป้าย}',
    '{Site Code}',
  ]);
  assert.deepEqual(Array.from(fields, field => field.key), ['Site Code','ที่อยู่','อุณหภูมิค่าอ่านเริ่มต้น,mA','img_รูปภาพป้าย']);
  assert.equal(fields[0].occurrences, 2);
  assert.equal(fields[3].type, 'image');
});

test('XLSX formula XML is preserved while text placeholders are filled', async () => {
  const reports = await loadReportsCore();
  const xml = '<worksheet><c t="inlineStr"><is><t>{Site Code}</t></is></c><c><f>CONCAT("{Site Code}",A1)</f><v>0</v></c></worksheet>';
  const output = reports.replaceXmlPlaceholders(xml, {'{Site Code}':'SITE-A'}, 'XLSX');
  assert.match(output, /<t>SITE-A<\/t>/);
  assert.match(output, /<f>CONCAT\("\{Site Code\}",A1\)<\/f>/);
});

test('report templates support named pages without manual page-number entry', async () => {
  const [reports, source, styles] = await Promise.all([loadReportsCore(), read('frontend/reports.js'), read('frontend/workhub-modules.css')]);
  const template = { fields:[{ key:'site_name', type:'text' },{ key:'reading', type:'number', page:9 }] };
  reports.normalizeTemplatePages(template);
  assert.deepEqual(Array.from(template.pages, page => ({ number:page.number, title:page.title })), [{ number:1, title:'ข้อมูลทั่วไป' }]);
  assert.deepEqual(Array.from(template.fields, field => field.page), [1,1]);
  assert.match(source, /data-page-add/);
  assert.match(source, /data-page-title/);
  assert.match(source, /data-template-page/);
  assert.match(source, /data-report-form-page/);
  assert.match(source, /ระบบกำหนดเลขหน้าให้อัตโนมัติ/);
  assert.match(styles, /\.template-page-manager\{/);
  assert.match(styles, /\.report-page-tabs\{/);
});

test('safe report formulas support field clicks, arithmetic, text, and degree trigonometry', async () => {
  const reports = await loadReportsCore();
  assert.equal(reports.evaluateFormula('{width} * {height} + 2', { width:3, height:4 }).value, 14);
  assert.equal(reports.evaluateFormula('CONCAT(UPPER({code}), "-", ROUND({reading}, 1))', { code:'sm', reading:12.34 }).value, 'SM-12.3');
  assert.equal(reports.evaluateFormula('SIN(30) + COS(60) + TAN(45)', {}).value, 2);
  assert.match(reports.evaluateFormula('{value} / 0', { value:10 }).error, /หารด้วยศูนย์/);
  assert.match(reports.evaluateFormula('UNKNOWN(1)', {}).error, /ไม่รองรับคำสั่ง/);
});
