import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function fixture(){
  const source=await fs.readFile(new URL('../frontend/reports.js',import.meta.url),'utf8');
  const context=vm.createContext({window:{},structuredClone,Date,Intl,Math});
  vm.runInContext(source.replace('window.ReportManagerModule=Object.freeze','window.readingTest={state,parameterCsvRows,readingCsvRows,resolveReadingCsvInstrument,schemaEditorRows,syncSchemaSettingsInputs};window.ReportManagerModule=Object.freeze'),context);
  const api=context.window.readingTest;
  const equipment={uid:'e1',id:'SM.1',groupId:'wg-internal',siteId:'s1',type:'Soil Moisture Sensor'};
  api.state.data={groups:[{id:'wg-internal',code:'P06811'},{id:'wg-other',code:'P06812'}],sites:[{uid:'s1',id:'69A_I1',groupId:'wg-internal'},{uid:'s2',id:'69A_I1',groupId:'wg-other'}],equipment:[equipment,{...equipment,uid:'e2',groupId:'wg-other',siteId:'s2'}],parameterData:{e1:{fields:[{key:'factor',type:'number'}],pages:[],rows:[]}},monitoringProfiles:[{id:'p1',fields:[{key:'reading',type:'number'},{key:'result',type:'formula',formula:'{reading}*2'}],pages:[]}],monitoringAssignments:{e1:'p1'}};
  return {api,equipment};
}

test('CSV templates expose configured Group ID and omit computed reading inputs',async()=>{
  const {api,equipment}=await fixture();
  for(const csv of [api.parameterCsvRows(equipment),api.readingCsvRows(equipment,'initial'),api.readingCsvRows(equipment,'monitoring')]){
    assert.equal(csv.rows[0][0],'P06811');assert.equal(csv.rows[0][1],'69A_I1');assert.equal(csv.rows[0][2],'SM.1');
  }
  assert.equal(api.readingCsvRows(equipment,'initial').headers.includes('result'),false);
});

test('CSV import resolves visible IDs case-insensitively without cross-site fallback',async()=>{
  const {api,equipment}=await fixture();const resolve=api.resolveReadingCsvInstrument;
  assert.equal(resolve('p06811','69a_i1','sm.1',equipment),equipment);
  assert.equal(resolve('wg-internal','69A_I1','SM.1',equipment),equipment);
  assert.equal(resolve('P06812','69A_I1','SM.1',equipment).uid,'e2');
  assert.equal(resolve('missing','69A_I1','SM.1',equipment),null);
  assert.equal(resolve('P06811','missing','SM.1',equipment),null);
  assert.equal(resolve('P06811','','SM.1',equipment),null);
  assert.equal(resolve('','','',equipment),equipment);
});

test('shared field editor preserves labels, page assignment, required state and choices',async()=>{
  const {api}=await fixture();const schema={name:'Before',pages:[{number:1,title:'Page'}],fields:[{key:'reading',label:'Reading',type:'number',page:1,formula:'',options:[]}]};
  const elements={schema_name:{value:'After'},field_label_0:{value:'Status'},field_type_0:{value:'quick'},field_page_0:{value:'1'},field_required_0:{checked:true}};
  api.syncSchemaSettingsInputs({elements,querySelectorAll:()=>[{dataset:{pageNumber:'1'},value:'Measurements'}],querySelector:()=>({value:'Pass | Fail'})},schema);
  assert.equal(schema.name,'After');assert.equal(schema.fields[0].label,'Status');assert.equal(schema.fields[0].type,'quick');assert.equal(schema.fields[0].required,true);assert.equal(schema.pages[0].title,'Measurements');assert.deepEqual(Array.from(schema.fields[0].options),['Pass','Fail']);
  const html=api.schemaEditorRows(schema);assert.ok(html.includes('data-formula-scope="schema"'));assert.ok(html.includes('name="field_type_0"'));assert.ok(!html.includes('data-template-'));
});
