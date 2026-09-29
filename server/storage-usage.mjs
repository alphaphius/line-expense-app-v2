import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { select } from './db.mjs';

let cached, pending;
export async function scanStorage({codeRoot,dataRoot,query}) {
  const buckets={code:0,database:null,image:0,documents:0,other:0},warnings=[],seen=new Set();
  const dataPath=path.resolve(dataRoot);
  async function walk(dir,isData=false){
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{warnings.push('อ่านพื้นที่บางส่วนไม่ได้');return;}
    for(const entry of entries){
      const full=path.join(dir,entry.name);
      if(entry.isSymbolicLink()||entry.name==='.git'||(!isData&&full===dataPath))continue;
      if(entry.isDirectory()){await walk(full,isData);continue;}
      if(!entry.isFile())continue;
      try{const stat=await fs.stat(full),id=`${stat.dev}:${stat.ino}`;if(seen.has(id))continue;seen.add(id);const ext=path.extname(entry.name).toLowerCase();const category=!isData?'code':/\.(png|jpg|jpeg|webp|gif|avif|heic|svg)$/.test(ext)?'image':/\.(pdf|docx?|xlsx?|csv|pptx?|zip)$/.test(ext)?'documents':'other';buckets[category]+=stat.size;}catch{warnings.push('มีไฟล์ที่อ่านขนาดไม่ได้');}
    }
  }
  await walk(codeRoot);await walk(dataPath,true);
  try{const rows=await query('SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH),0) AS bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');buckets.database=Number(rows[0]?.bytes)||0;}catch{warnings.push('อ่านขนาดฐานข้อมูลไม่ได้');}
  const labels={code:'Code และไลบรารี',database:'Database และ Index',image:'รูปภาพ',documents:'เอกสาร / Template / Export',other:'ไฟล์อื่น ๆ'};
  return {measuredAt:new Date().toISOString(),totalBytes:Object.values(buckets).reduce((a,b)=>a+(b||0),0),partial:warnings.length>0,categories:Object.entries(buckets).map(([key,bytes])=>({key,label:labels[key],bytes})),warnings:[...new Set(warnings)],note:'ขนาดไฟล์จริงและพื้นที่ตาราง/Index โดยประมาณจาก MariaDB ไม่รวมระบบ NAS, Docker layers, log ของฐานข้อมูล และ backup ภายนอกแอป · 1 MB = 1,000,000 bytes'};
}
export function getStorageUsage(){
  if(cached&&Date.now()-cached.time<60000)return Promise.resolve(cached.value);
  if(pending)return pending;
  pending=scanStorage({codeRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dataRoot:config.dataDir,query:select}).then(value=>{cached={time:Date.now(),value};return value;}).finally(()=>{pending=null;});return pending;
}
