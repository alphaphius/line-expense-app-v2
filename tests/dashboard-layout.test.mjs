import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('category graph aggregates all monthly bills rather than the 50 dashboard rows',async()=>{
  const source=await fs.readFile(new URL('../server/actions/masters.mjs',import.meta.url),'utf8');
  const rows=Array.from({length:60},(_,i)=>({document_date:'2026-09-15',created_at:'2026-09-15',category_name:i<30?'วัสดุ':'เดินทาง',grand_total:100,source_user_name:i<50?'A':'B'}));
  rows.push({document_date:'2026-08-15',grand_total:999,source_user_name:'A',category_name:'วัสดุ'});
  const context=vm.createContext({normalizePeriod:p=>p,select:async()=>rows,enrichBill:r=>r,number:v=>Number(v)||0,aggregate:()=>[],aggregateOwners:()=>[],ownerLabel:r=>r.source_user_name});
  new vm.Script(source.slice(source.indexOf('export async function getDashboard('),source.indexOf('export async function getBootstrapData(')).replace('export async','async')+';globalThis.getDashboard=getDashboard;').runInContext(context);
  const all=await context.getDashboard({period:'2026-09'});
  assert.equal(all.bills.length,50);assert.equal(all.categorySeries.reduce((s,c)=>s+c.total,0),6000);
  assert.equal(all.categorySeries.find(c=>c.label==='วัสดุ').days['2026-09-15'],3000);
  const owner=await context.getDashboard({period:'2026-09',view_mode:'person',owners:[]});
  assert.equal(owner.categorySeries.length,0);
});

test('mobile and desktop layout configurations remain independent and omit deleted fields',async()=>{
  const context=vm.createContext({window:{}});new vm.Script(await fs.readFile(new URL('../frontend/field-layout.js',import.meta.url),'utf8')).runInContext(context);
  const schema={fields:[{key:'a'},{key:'b'},{key:'c'}],layout:{desktop:{columns:4,order:['c','a','removed']},mobile:{columns:2,order:['b','a'],spans:{b:2}}}};
  const {settings}=context.window.WorkHubFieldLayout;
  assert.deepEqual(Array.from(settings(schema,'desktop').order),['c','a','b']);
  assert.deepEqual(Array.from(settings(schema,'mobile').order),['b','a','c']);
  assert.equal(settings(schema,'desktop').columns,4);assert.equal(settings(schema,'mobile').columns,2);
  assert.equal(settings(schema,'mobile').spans.b,2);assert.equal(settings(schema,'desktop').spans.b,undefined);
});
