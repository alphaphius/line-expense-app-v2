import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('bill list aggregates and orders the full filtered set independently of page size',async()=>{
  const source=await fs.readFile(new URL('../server/actions/masters.mjs',import.meta.url),'utf8');
  const queries=[],all=Array.from({length:27},(_,i)=>({bill_id:`owner-a-${i}`,grand_total:100}));
  const context=vm.createContext({
    clean:(value,max)=>String(value??'').slice(0,max),enrichBill:row=>row,
    one:async(sql,params)=>{queries.push({sql,params:{...params}});return {total:27,net_total:2700};},
    select:async(sql,params)=>{queries.push({sql,params:{...params}});return sql.includes('LIMIT :limit')?all.slice(params.offset,params.offset+params.limit):all.map(({bill_id})=>({bill_id}));}
  });
  new vm.Script(source.slice(source.indexOf('export async function listBills('),source.indexOf('export async function getDashboard(')).replace('export async','async')+'; globalThis.listBills=listBills;').runInContext(context);
  const result=await context.listBills({owner_ids:['owner-a'],month:'2026-09',page:2,page_size:20,include_context:true,sort_by:'created_at',sort_dir:'desc'});
  assert.equal(result.rows.length,7);assert.equal(result.context_ids.length,27);assert.equal(result.net_total,2700);
  assert.equal(result.context_ids[26],'owner-a-26');
  for(const query of queries){assert.match(query.sql,/source_user_id IN \(:owner0\)/);assert.match(query.sql,/'%Y-%m'\) = :period/);assert.equal(query.params.owner0,'owner-a');assert.equal(query.params.period,'2026-09');}
  assert.match(queries[0].sql,/SUM\(b.grand_total\)/);
  assert.doesNotMatch(queries.at(-1).sql,/LIMIT/);
});
