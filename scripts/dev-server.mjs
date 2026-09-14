import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBillXlsx, createSimpleBillDocx } from '../server/exports.mjs';

const root = path.resolve(import.meta.dirname, '..', 'dist');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.wasm':'application/wasm', '.gz':'application/gzip', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };
const port = Number(process.env.PORT || 4173);
const mockSession = { token:'local-preview-session-token-000000000000', expiresAt:Date.now() + 6 * 60 * 60 * 1000, accessMode:'OPEN' };
const mockData = {
  appName: 'WorkHub', liffId: '', frontendUrl:'http://127.0.0.1:' + port,
  modules: { expenses:true, receipts:true, payroll:true, tasks:true },
  masters: {
    projects: [{ project_id: 'P1', project_name: 'โครงการทั่วไป' }],
    companies: [{ company_id: 'C1', company_name: 'บริษัทตัวอย่าง' }],
    categories: [{ category_id: 'K1', category_name: 'อื่นๆ' },{ project_id:'', category_id:'K2', category_name:'น้ำมัน' }], vendors: [],
    billOwners: [
      { user_id:'U1', display_name:'สมชาย ใจดี' },
      { user_id:'U2', display_name:'วิทยา กันหา' },
      { user_id:'U3', display_name:'สมหญิง มั่นคง' },
    ],
  },
  bills: [
    {bill_id:'B1',document_date:'2026-09-13',created_at:'2026-09-13 09:00:00',vendor_name:'ปั๊มน้ำมันตัวอย่าง',document_no:'INV-1001',project_id:'P1',project_name:'โครงการทั่วไป',company_id:'C1',company_name:'บริษัทตัวอย่าง',category_id:'K2',category_name:'น้ำมัน',source_user_id:'U1',source_user_name:'สมชาย ใจดี',grand_total:1250,status:'CONFIRMED'},
    {bill_id:'B2',document_date:'2026-09-12',created_at:'2026-09-12 14:00:00',vendor_name:'ร้านวัสดุก่อสร้าง',document_no:'INV-1002',project_id:'P1',project_name:'โครงการทั่วไป',company_id:'C1',company_name:'บริษัทตัวอย่าง',category_id:'K1',category_name:'อื่นๆ',source_user_id:'U2',source_user_name:'วิทยา กันหา',grand_total:3480,status:'CONFIRMED'},
    {bill_id:'B3',document_date:'2026-09-11',created_at:'2026-09-11 17:30:00',vendor_name:'โรงแรมตัวอย่าง',document_no:'INV-1003',project_id:'P1',project_name:'โครงการทั่วไป',company_id:'C1',company_name:'บริษัทตัวอย่าง',category_id:'K1',category_name:'อื่นๆ',source_user_id:'U1',source_user_name:'สมชาย ใจดี',grand_total:1900,status:'NEEDS_REVIEW'},
    {bill_id:'B4',document_date:'2026-09-10',created_at:'2026-09-10 08:20:00',vendor_name:'ร้านอุปกรณ์สำนักงาน',document_no:'INV-1004',project_id:'P1',project_name:'โครงการทั่วไป',company_id:'C1',company_name:'บริษัทตัวอย่าง',category_id:'K1',category_name:'อื่นๆ',source_user_id:'U3',source_user_name:'สมหญิง มั่นคง',grand_total:760,status:'CONFIRMED'},
  ],
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

function filterMockBills(filters = {}) {
  let rows = mockData.bills.slice();
  if (Array.isArray(filters.owner_ids)) rows = rows.filter(row => filters.owner_ids.includes(row.source_user_id));
  if (filters.status) rows = rows.filter(row => row.status === filters.status); else rows = rows.filter(row => row.status !== 'REJECTED');
  if (filters.project_id) rows = rows.filter(row => row.project_id === filters.project_id);
  if (filters.company_id) rows = rows.filter(row => row.company_id === filters.company_id);
  if (filters.category_id) rows = rows.filter(row => row.category_id === filters.category_id);
  if (filters.date_from) rows = rows.filter(row => row.document_date >= filters.date_from);
  if (filters.date_to) rows = rows.filter(row => row.document_date <= filters.date_to);
  if (filters.month) rows = rows.filter(row => row.document_date.slice(0,7) === String(filters.month).slice(0,7));
  if (filters.query) { const query=String(filters.query).toLowerCase(); rows=rows.filter(row=>Object.values(row).join(' ').toLowerCase().includes(query)); }
  return rows;
}

async function mockAction(action, args = []) {
  if (action === 'health') return { appName:mockData.appName, appVersion:'3.1.0', apiVersion:'2.0', schemaVersion:3, accessMode:'OPEN', loginRequired:false, sessionRequired:false, pinMustChange:false, liffId:'', frontendUrl:mockData.frontendUrl, modules:mockData.modules };
  if (action === 'openSession') return mockSession;
  if (action === 'openProtectedSession') return { token:'local-protected-session-token-000000000', expiresAt:Date.now() + 6 * 60 * 60 * 1000 };
  if (action === 'getBootstrapData') return mockData;
  if (action === 'getDashboard') return mockData.dashboard;
  if (action === 'getBillOwners') return mockData.masters.billOwners;
  if (action === 'listBills') {
    const filters=args[0]||{}, all=filterMockBills(filters), pageSize=Number(filters.page_size)||25, pages=Math.max(1,Math.ceil(all.length/pageSize)), page=Math.max(1,Math.min(pages,Number(filters.page)||1));
    return { rows:all.slice((page-1)*pageSize,page*pageSize), total:all.length, page, pages, pageSize };
  }
  if (action === 'exportMonthlyBillExcel') {
    const rows=filterMockBills(args[0]||{}), buffer=await createBillXlsx(rows);
    return {fileName:'workhub-local-bills.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sizeBytes:buffer.length,count:rows.length,base64:buffer.toString('base64')};
  }
  if (action === 'exportMonthlyBillWord') {
    const rows=filterMockBills(args[0]||{}).map(row=>({...row,documents:[]})), buffer=await createSimpleBillDocx('',rows);
    return {fileName:'workhub-local-bills.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sizeBytes:buffer.length,count:rows.length,base64:buffer.toString('base64')};
  }
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
      const data = await mockAction(body.action, body.args || []);
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
