import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('map popup lists only the selected site instruments and escapes their labels',async()=>{
  const source=await fs.readFile(new URL('../frontend/reports.js',import.meta.url),'utf8'),context=vm.createContext({window:{},structuredClone,Date,Intl,Math});
  vm.runInContext(source.replace('window.ReportManagerModule=Object.freeze','window.mapTest={state,mapInstrumentLinks};window.ReportManagerModule=Object.freeze'),context);
  const {state,mapInstrumentLinks}=context.window.mapTest;state.data={equipment:[{uid:'a',id:'SM <1>',type:'Soil',siteId:'site-a'},{uid:'b',id:'OTHER',type:'Radar',siteId:'site-b'}]};
  const html=mapInstrumentLinks({siteUid:'site-a'});assert.match(html,/data-map-instrument="a"/);assert.match(html,/SM &lt;1&gt;/);assert.doesNotMatch(html,/OTHER/);assert.equal(mapInstrumentLinks({}), '');
});
