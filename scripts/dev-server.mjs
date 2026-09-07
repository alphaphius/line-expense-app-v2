import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'dist');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.wasm':'application/wasm', '.gz':'application/gzip', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };
const port = Number(process.env.PORT || 4173);
const mockSession = { token:'local-preview-session-token-000000000000', expiresAt:Date.now() + 6 * 60 * 60 * 1000, accessMode:'OPEN' };
const mockData = {
  appName: 'Phius WorkHub', liffId: '', frontendUrl:'http://127.0.0.1:' + port,
  modules: { expenses:true, receipts:true, payroll:false, tasks:false },
  masters: {
    projects: [{ project_id: 'P1', project_name: 'โครงการทั่วไป' }],
    companies: [{ company_id: 'C1', company_name: 'บริษัทตัวอย่าง' }],
    categories: [{ category_id: 'K1', category_name: 'อื่นๆ' }], vendors: [],
  },
  dashboard: {
    summary: {
      currentMonth: { total: 12500, period: '2026-09' }, currentYear: { total: 148000, year: 2026 },
      previousMonth: { total: 9800, period: '2026-08', projects: [{ project_id: 'P1', project_name: 'โครงการทั่วไป', total: 9800 }] },
    },
    totals: { review: 0 }, byMonth: [{ label: '2026-08', total: 9800 }, { label: '2026-09', total: 12500 }],
    uploaderSummary: [{ label: 'สมชาย', total: 12500, count: 4 }], personBreakdowns: [],
    filters: { period: '2026-09', currentPeriod: '2026-09', viewMode: 'overall', selectedOwners: [] }, ownerOptions: [], bills: [],
  },
  pendingReviews: [], quickSettings: { slots: [], configured_count: 0, any_configured: false },
  receiptWorkspace: {
    enabled:true,
    templates:[{ template_id:'T1', template_name:'ใบรับเงินมาตรฐาน', source_format:'DOCX', page_count:1 }],
    groups:[{ group_id:'G1', group_name:'แรงงานประจำ', group_type:'PERMANENT', project_id:'', site_name:'' },{ group_id:'G2', group_name:'ทีมโครงการทั่วไป', group_type:'SITE', project_id:'P1', site_name:'โครงการทั่วไป' }],
    projects:[{ project_id:'P1', project_name:'โครงการทั่วไป' }],
    registrations:{ rows:[{ registration_id:'R1', worker_id:'W1', template_id:'T1', group_id:'G1', full_name:'สมชาย ตัวอย่าง', national_id_masked:'1-XXXX-XXXXX-12', address:'กรุงเทพฯ', status:'SAVED', updated_at:'2026-09-07T09:00:00+07:00' }], total:1 },
  },
};

function mockAction(action) {
  if (action === 'health') return { appName:mockData.appName, appVersion:'3.1.0', apiVersion:'2.0', schemaVersion:3, accessMode:'OPEN', loginRequired:false, sessionRequired:false, pinMustChange:false, liffId:'', frontendUrl:mockData.frontendUrl, modules:mockData.modules };
  if (action === 'openSession') return mockSession;
  if (action === 'openProtectedSession') return { token:'local-protected-session-token-000000000', expiresAt:Date.now() + 6 * 60 * 60 * 1000 };
  if (action === 'getBootstrapData') return mockData;
  if (action === 'getDashboard') return mockData.dashboard;
  if (action === 'listBills') return { rows:[], total:0, page:1, pages:1, pageSize:25 };
  if (action === 'listPendingReviewBills') return [];
  if (action === 'getQuickSettings' || action === 'saveQuickSettings' || action === 'clearQuickSettings') return mockData.quickSettings;
  if (action === 'getSystemStatus') return { spreadsheet:'Local mock', folder:'Local mock', geminiConfigured:false, lineConfigured:false, model:'gemini-3.5-flash-lite', version:'3.1.0', lineDiagnostics:{ warnings:['Local preview'] }, geminiDiagnostics:{ message:'Local preview', valid:false } };
  if (action === 'getReceiptWorkspace') return mockData.receiptWorkspace;
  if (action === 'listReceiptRegistrations') return mockData.receiptWorkspace.registrations;
  if (action === 'previewReceiptExport') return { total:1, groups:[{ group_id:'G1', group_name:'แรงงานประจำ', site_name:'', people:[{ registration_id:'R1', full_name:'สมชาย ตัวอย่าง', national_id_masked:'1-XXXX-XXXXX-12' }] }] };
  return {};
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (request.method === 'POST' && pathname === '/__mock_api__') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const data = mockAction(body.action);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, data, error: null, apiVersion: '2.0' }));
      return;
    }
    if (request.method === 'GET' && pathname === '/config.js') {
      response.writeHead(200, { 'Content-Type':'text/javascript; charset=utf-8', 'Cache-Control':'no-store' });
      response.end(`window.LINE_EXPENSE_CONFIG=Object.freeze({apiVersion:'2.0',apiEndpoint:location.origin+'/__mock_api__',requestTimeoutMs:90000,longRequestTimeoutMs:330000});`);
      return;
    }
    let file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if (!file.startsWith(root)) throw new Error('invalid path');
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) file = path.join(root, 'index.html');
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(404); response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
