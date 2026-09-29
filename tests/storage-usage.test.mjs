import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scanStorage} from '../server/storage-usage.mjs';
test('storage classifies code, nested data and database without counting data twice',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workhub-storage-test-'));
  try{const data=path.join(root,'data');await fs.mkdir(data);await fs.writeFile(path.join(root,'app.js'),'1234');await fs.writeFile(path.join(data,'photo.jpg'),'12345');await fs.writeFile(path.join(data,'report.pdf'),'123456');await fs.writeFile(path.join(data,'misc.bin'),'123');await fs.symlink(path.join(data,'photo.jpg'),path.join(root,'image-link'));
    const result=await scanStorage({codeRoot:root,dataRoot:data,query:async()=>[{bytes:20}]});
    assert.equal(result.totalBytes,38);assert.equal(result.partial,false);assert.equal(result.categories.find(c=>c.key==='image').bytes,5);
    const unavailable=await scanStorage({codeRoot:root,dataRoot:data,query:async()=>{throw Error('offline');}});assert.equal(unavailable.partial,true);assert.equal(unavailable.categories.find(c=>c.key==='database').bytes,null);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
