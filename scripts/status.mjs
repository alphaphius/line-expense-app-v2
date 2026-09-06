import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const commands = process.platform === 'win32'
  ? [['git.exe', ['status', '--short']], ['gh.exe', ['auth', 'status']], [path.join(root, 'node_modules', '.bin', 'clasp.cmd'), ['status']]]
  : [['git', ['status', '--short']], ['gh', ['auth', 'status']], [path.join(root, 'node_modules', '.bin', 'clasp'), ['status']]];
for (const [command, args] of commands) {
  console.log(`\n${path.basename(command)} ${args.join(' ')}`);
  await new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', error => { console.log(error.message); resolve(); });
    child.on('exit', () => resolve());
  });
}
