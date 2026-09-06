import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';
await new Promise((resolve, reject) => {
  const child = spawn(gh, ['workflow', 'run', 'pages.yml'], { cwd: root, stdio: 'inherit' });
  child.on('error', () => reject(new Error('ไม่พบ GitHub CLI หรือยังไม่ได้ login')));
  child.on('exit', code => code === 0 ? resolve() : reject(new Error('สั่ง GitHub Pages workflow ไม่สำเร็จ')));
});
console.log('GitHub Pages workflow started. Use npm run status to inspect repository state.');
