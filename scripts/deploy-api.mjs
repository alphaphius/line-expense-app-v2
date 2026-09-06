import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
await access(path.join(root, '.clasp.json')).catch(() => { throw new Error('ยังไม่มี .clasp.json กรุณารัน npm run setup ก่อน'); });
const clasp = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'clasp.cmd' : 'clasp');
async function run(args, label) {
  await new Promise((resolve, reject) => {
    const child = spawn(clasp, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(label + ' failed')));
  });
}

await run(['push'], 'clasp push');
const deployment = JSON.parse(await readFile(path.join(root, 'deployment.json'), 'utf8'));
if (deployment.deploymentId) {
  await run(['redeploy', deployment.deploymentId, '--description', `Line Expense App V2 ${deployment.version || ''}`.trim()], 'clasp redeploy');
  console.log('Apps Script source pushed and Web App redeployed: ' + deployment.webAppUrl);
} else {
  console.log('Apps Script source pushed. Create the first Web App deployment and record it in deployment.json.');
}
