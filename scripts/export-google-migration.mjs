import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const endpoint=String(process.env.SOURCE_API_URL||'').trim();
const output=path.resolve(process.env.MIGRATION_FILE||'migration-data/google-export.json');
if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint))throw new Error('กำหนด SOURCE_API_URL เป็น Apps Script /exec URL ก่อน');
const deviceId=`migration-${crypto.randomUUID().replace(/-/g,'')}`;let sessionToken='';
async function call(action,...args){const requestId=crypto.randomUUID().replace(/-/g,'');const response=await fetch(`${endpoint}?requestId=${requestId}`,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({apiVersion:'2.0',action,args,requestId,sessionToken,protectedToken:''}),signal:AbortSignal.timeout(330000)});const result=await response.json();if(!result.ok)throw new Error(`${action}: ${result.error?.message||'ไม่สำเร็จ'}`);return result.data;}
const health=await call('health');sessionToken=(await call('openSession',deviceId)).token;const bootstrap=await call('getBootstrapData',{});const statuses=['CONFIRMED','NEEDS_REVIEW','PENDING_CONFIRMATION','REJECTED'];const billMap=new Map();
for(const status of statuses){let page=1,pages=1;do{const result=await call('listBills',{status,page,page_size:100,sort_by:'created_at',sort_dir:'asc'});for(const row of result.rows||[])billMap.set(row.bill_id,row);pages=Number(result.pages)||1;page+=1;}while(page<=pages);}
const bills=[];let documentCount=0;
for(const row of billMap.values()){const detail=await call('getBillDetail',row.bill_id);const documents=[];for(const document of detail.documents||[]){const preview=await call('getBillDocumentPreview',document.doc_id);documents.push({...document,data_url:preview.dataUrl||'',external_url:preview.externalUrl||''});documentCount+=1;}bills.push({record:Object.fromEntries(Object.entries(detail).filter(([key])=>!['items','documents','project_name','company_name','category_name'].includes(key))),items:detail.items||[],documents});}
const manifest={format:'workhub-google-migration',version:1,exported_at:new Date().toISOString(),source:{app_name:health.appName,app_version:health.appVersion,schema_version:health.schemaVersion},masters:bootstrap.masters,quick_settings:bootstrap.quickSettings,bills,counts:{projects:bootstrap.masters.projects.length,companies:bootstrap.masters.companies.length,categories:bootstrap.masters.categories.length,vendors:bootstrap.masters.vendors.length,bills:bills.length,bill_items:bills.reduce((sum,bill)=>sum+bill.items.length,0),bill_documents:documentCount}};
await fs.mkdir(path.dirname(output),{recursive:true,mode:0o700});await fs.writeFile(output,JSON.stringify(manifest,null,2),{mode:0o600});console.log(JSON.stringify({ok:true,output,counts:manifest.counts}));

