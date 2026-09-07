import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';

const root = path.resolve(import.meta.dirname, '..');
const claspFile = path.join(root, '.clasp.json');
const stateFile = path.join(root, '.setup-state.json');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('Phius WorkHub setup');
let hasClasp = true;
try { await access(claspFile); } catch (_) { hasClasp = false; }
if (!hasClasp) {
  const scriptId = (await rl.question('วาง Apps Script ID ของ V2 (เว้นว่างเพื่อทำภายหลัง): ')).trim();
  if (scriptId) {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(scriptId)) throw new Error('Script ID ไม่ถูกต้อง');
    await writeFile(claspFile, JSON.stringify({ scriptId, rootDir: 'apps-script' }, null, 2) + '\n');
    console.log('สร้าง .clasp.json แล้ว (ไฟล์นี้ไม่ถูก commit)');
  }
}
await writeFile(stateFile, JSON.stringify({ setupVersion: 1, updatedAt: new Date().toISOString(), claspConfigured: hasClasp || await access(claspFile).then(() => true).catch(() => false) }, null, 2) + '\n');
rl.close();
console.log('ต่อไป: npm run verify → npm run deploy:api → ตั้ง Script Properties → npm run deploy:web');
