import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

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
  for (const asset of ['workhub-core.js','tasks.js','payroll.js','reports.js','workhub-modules.css']) {
    assert.match(build, new RegExp(asset.replace('.', '\\.')));
    assert.match(worker, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(build, /jszip\.min\.js/);
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

test('reports support reusable templates, site-scoped equipment IDs, CSV imports, favorites, and hierarchical export selection', async () => {
  const [reports, styles] = await Promise.all([read('frontend/reports.js'), read('frontend/workhub-modules.css')]);
  assert.match(reports, /workhub-installation-reports-v2/);
  assert.match(reports, /async function scanTemplate/);
  assert.match(reports, /fieldKey\.startsWith\('img_'\)/);
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
  assert.match(reports, /แสดงอุปกรณ์ทั้งหมดโดยไม่ต้องเลือก Filter/);
  assert.match(reports, /headers:\['work_group_id','site_id','site_name','province'/);
  assert.match(reports, /1 Text Box = 1 รูป/);
  assert.match(reports, /IndexedDB|indexedDB/);
  assert.match(reports, /policy==='blank'/);
  assert.match(reports, /policy==='overwrite'/);
  assert.match(styles, /\.report-tabs::-webkit-scrollbar\{display:block/);
  assert.match(styles, /\.report-shell \[data-csv-import\]\{width:40px!important/);
  assert.match(styles, /\.report-province:not\(\[open\]\)/);
  assert.match(styles, /\.report-shell\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.report-journey-site>\.report-favorite-button\{position:absolute;top:-11px/);
});

test('reports replace split DOCX and XLSX text placeholders without changing the file layout nodes', async () => {
  const reports = await loadReportsCore();
  const docx = '<w:p><w:r><w:t>{site_</w:t></w:r><w:r><w:t>name}</w:t></w:r></w:p>';
  const xlsx = '<xdr:sp><a:p><a:r><a:t>{equipment_</a:t></a:r><a:r><a:t>id}</a:t></a:r></a:p></xdr:sp>';
  assert.match(reports.replaceXmlPlaceholders(docx, {'{site_name}':'ไซต์ A & B'}, 'DOCX'), /ไซต์ A &amp; B/);
  assert.match(reports.replaceXmlPlaceholders(xlsx, {'{equipment_id}':'SM1'}, 'XLSX'), /SM1/);
});
