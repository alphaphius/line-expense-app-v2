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
  assert.match(payroll, /sheetXml/);
  assert.doesNotMatch(payroll, /ปรับเพิ่ม\/ลด/);
});

test('build and offline shell include both local-test modules', async () => {
  const [build, worker] = await Promise.all([read('scripts/build.mjs'), read('frontend/service-worker.js')]);
  for (const asset of ['workhub-core.js','tasks.js','payroll.js','workhub-modules.css']) {
    assert.match(build, new RegExp(asset.replace('.', '\\.')));
    assert.match(worker, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(build, /jszip\.min\.js/);
});
