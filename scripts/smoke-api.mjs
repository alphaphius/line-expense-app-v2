import { randomUUID } from 'node:crypto';
import process from 'node:process';

const endpoint = String(process.env.V2_API_ENDPOINT || 'https://script.google.com/macros/s/AKfycbwoLrlaVEI_wF0raV46IBTPQ-s6K9B0WtMTsoZaFpzoX-DZG03iN5Ureh5Rx9uslT_RAw/exec').trim();
const pin = String(process.env.V2_API_PIN || '').trim();
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) throw new Error('V2_API_ENDPOINT ไม่ถูกต้อง');
if (!/^\d{4,8}$/.test(pin)) throw new Error('กำหนด V2_API_PIN เป็นตัวเลข 4–8 หลักก่อนรัน smoke test');

async function request(action, args, sessionToken) {
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(330000),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      apiVersion: '2.0', action, args: args || [], sessionToken: sessionToken || '',
      requestId: randomUUID().replace(/-/g, ''),
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error(`${result.error && result.error.code || 'API_ERROR'}: ${result.error && result.error.message || 'Unknown error'}`);
  return result.data;
}

const health = await request('health');
const auth = await request('verifyPin', [pin, 'v2smoketestdevice20260906']);
const bootstrap = await request('getBootstrapData', [{}], auth.token);
const status = await request('getSystemStatus', [], auth.token);

console.log(JSON.stringify({
  endpointOk: true,
  app: health.appName,
  version: health.appVersion,
  pinMustChange: health.pinMustChange,
  schemaVersion: health.schemaVersion,
  masterCounts: {
    projects: bootstrap.masters.projects.length,
    companies: bootstrap.masters.companies.length,
    categories: bootstrap.masters.categories.length,
  },
  dashboardReady: !!bootstrap.dashboard,
  spreadsheet: status.spreadsheet,
  driveFolder: status.folder,
  geminiConfigured: status.geminiConfigured,
  lineConfigured: status.lineConfigured,
}, null, 2));
