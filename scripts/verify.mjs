import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [['test'], ['run', 'build']]) {
  await new Promise((resolve, reject) => {
    const child = spawn(npm, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} failed`)));
  });
}
console.log('Verification passed. Live Apps Script CORS and LINE webhook checks remain deployment-time checks.');
