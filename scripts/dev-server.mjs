import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'dist');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (request.method === 'POST' && pathname === '/__mock_api__') {
      const data = {
        appName: 'Line Expense App V2', liffId: '',
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
      };
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, data, error: null, apiVersion: '2.0' }));
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
