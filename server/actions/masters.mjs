import { config } from '../config.mjs';
import { execute, one, select, transaction } from '../db.mjs';
import { apiError, bool, clean, normalizePeriod, nowSql, number, publicRow, uuid } from '../utils.mjs';

const MASTER_MAP = Object.freeze({
  project: { table: 'projects', id: 'project_id', name: 'project_name', fields: ['project_code', 'project_name', 'description'] },
  company: { table: 'companies', id: 'company_id', name: 'company_name', fields: ['company_name', 'branch_name', 'tax_id', 'address'] },
  category: { table: 'categories', id: 'category_id', name: 'category_name', fields: ['category_name', 'aliases'] },
});

function enrichBill(row) {
  const bill = publicRow(row);
  bill.needs_review = bool(bill.needs_review);
  bill.company_match = bill.company_match == null ? false : bool(bill.company_match);
  bill.tax_id_match = bill.tax_id_match == null ? false : bool(bill.tax_id_match);
  bill.address_match = bill.address_match == null ? false : bool(bill.address_match);
  bill.review_reasons = Array.isArray(bill.review_reasons) ? bill.review_reasons.join(' | ') : clean(bill.review_reasons, 2000);
  return bill;
}

export async function ensureDefaults() {
  const [{ count: projectCount }] = await select('SELECT COUNT(*) AS count FROM projects');
  const [{ count: companyCount }] = await select('SELECT COUNT(*) AS count FROM companies');
  const [{ count: categoryCount }] = await select('SELECT COUNT(*) AS count FROM categories');
  const [{ count: groupCount }] = await select('SELECT COUNT(*) AS count FROM labor_groups');
  const timestamp = nowSql();
  if (!projectCount) await execute('INSERT INTO projects (project_id, project_code, project_name, description, active, created_at, updated_at) VALUES (:id, :code, :name, :description, 1, :created, :updated)', { id: uuid(), code: 'GENERAL', name: 'งานทั่วไป', description: 'โครงการเริ่มต้น', created: timestamp, updated: timestamp });
  if (!companyCount) {
    const defaults = [
      ['บริษัท วิศวกรรมธรณีและฐานราก จำกัด', 'สำนักงานใหญ่', '0105536084347', '151 ถนนนวลจันทร์ แขวงนวลจันทร์ เขตบึงกุ่ม กทม. 10230'],
      ['บริษัท ทีม คอนซัลติ้ง เอนจิเนียริ่ง แอนด์ แมเนจเมนท์ จำกัด (มหาชน)', 'สำนักงานใหญ่', '0107561000030', '151 ถนนนวลจันทร์ แขวงนวลจันทร์ เขตบึงกุ่ม กรุงเทพฯ 10230'],
    ];
    for (const [name, branch, tax, address] of defaults) await execute('INSERT INTO companies (company_id, company_name, branch_name, tax_id, address, active, created_at, updated_at) VALUES (:id, :name, :branch, :tax, :address, 1, :created, :updated)', { id: uuid(), name, branch, tax, address, created: timestamp, updated: timestamp });
  }
  if (!categoryCount) {
    const defaults = [['ค่าผ่านทาง/ทางด่วน','ค่าทางด่วน,ค่าผ่านทาง,toll,m-pass,easypass'],['เอกสารใบส่งของ','ใบส่งของ,delivery note'],['การบริการ','ค่าบริการ,service'],['วัสดุอุปกรณ์','วัสดุ,อุปกรณ์,เครื่องมือ'],['ที่พัก','โรงแรม,ที่พัก,hotel'],['อาหาร/เดินทาง','อาหาร,น้ำมัน,แท็กซี่,เดินทาง'],['อื่นๆ','อื่นๆ,other']];
    for (const [name, aliases] of defaults) await execute('INSERT INTO categories (category_id, category_name, aliases, active, created_at, updated_at) VALUES (:id, :name, :aliases, 1, :created, :updated)', { id: uuid(), name, aliases, created: timestamp, updated: timestamp });
  }
  if (!groupCount) await execute('INSERT INTO labor_groups (group_id, group_name, group_type, project_id, active, created_at, updated_at) VALUES (:id, :name, :type, :project, 1, :created, :updated)', { id: uuid(), name: 'แรงงานประจำ', type: 'PERMANENT', project: '', created: timestamp, updated: timestamp });
}

export async function listBillOwners() {
  const rows = await select("SELECT user_id, display_name, picture_url, last_seen_at FROM line_users WHERE user_id REGEXP '^U[0-9A-Fa-f]{32}$' ORDER BY display_name, last_seen_at DESC LIMIT 500");
  return rows.map(publicRow);
}

export async function listMasterData() {
  const [projects, companies, categories, vendors, billOwners] = await Promise.all([
    select('SELECT * FROM projects WHERE active = 1 ORDER BY project_name'),
    select('SELECT * FROM companies WHERE active = 1 ORDER BY company_name'),
    select('SELECT * FROM categories WHERE active = 1 ORDER BY category_name'),
    select('SELECT * FROM vendors ORDER BY use_count DESC, last_used_at DESC LIMIT 500'),
    listBillOwners(),
  ]);
  return { projects: projects.map(publicRow), companies: companies.map(publicRow), categories: categories.map(publicRow), vendors: vendors.map(publicRow), billOwners };
}

export async function saveMasterData(type, payload = {}, actor = 'WEB') {
  const map = MASTER_MAP[clean(type, 20)];
  if (!map) throw apiError('INVALID_MASTER_TYPE', 'ประเภทข้อมูลไม่ถูกต้อง');
  const values = {};
  for (const field of map.fields) values[field] = clean(payload[field], field === 'address' || field === 'description' || field === 'aliases' ? 1000 : 255);
  if (!values[map.name]) throw apiError('REQUIRED_FIELDS', 'กรุณากรอกชื่อ');
  if (type === 'company') {
    values.tax_id = values.tax_id.replace(/\D/g, '');
    if (!/^\d{13}$/.test(values.tax_id)) throw apiError('INVALID_TAX_ID', 'เลขผู้เสียภาษีต้องมี 13 หลัก');
  }
  const id = clean(payload[map.id], 64) || uuid();
  const timestamp = nowSql();
  return transaction(async connection => {
    const [beforeRows] = await connection.execute(`SELECT * FROM ${map.table} WHERE ${map.id} = ? FOR UPDATE`, [id]);
    const before = beforeRows[0] || null;
    if (before) {
      const set = [...map.fields.map(field => `${field} = ?`), 'active = 1', 'updated_at = ?'].join(', ');
      await connection.execute(`UPDATE ${map.table} SET ${set} WHERE ${map.id} = ?`, [...map.fields.map(field => values[field]), timestamp, id]);
    } else {
      const columns = [map.id, ...map.fields, 'active', 'created_at', 'updated_at'];
      await connection.execute(`INSERT INTO ${map.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, [id, ...map.fields.map(field => values[field]), 1, timestamp, timestamp]);
    }
    const [rows] = await connection.execute(`SELECT * FROM ${map.table} WHERE ${map.id} = ?`, [id]);
    const after = rows[0];
    await connection.execute('INSERT INTO audit_logs (log_id, entity_type, entity_id, action, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [uuid(), type, id, before ? 'UPDATE' : 'CREATE', clean(actor, 160), before ? JSON.stringify(publicRow(before)) : null, JSON.stringify(publicRow(after)), timestamp]);
    return publicRow(after);
  });
}

export async function deleteMasterData(type, id, actor = 'WEB') {
  const map = MASTER_MAP[clean(type, 20)];
  if (!map) throw apiError('INVALID_MASTER_TYPE', 'ประเภทข้อมูลไม่ถูกต้อง');
  const current = await one(`SELECT * FROM ${map.table} WHERE ${map.id} = :id`, { id: clean(id, 64) });
  if (!current) throw apiError('NOT_FOUND', 'ไม่พบข้อมูล');
  const timestamp = nowSql();
  await execute(`UPDATE ${map.table} SET active = 0, updated_at = :updated WHERE ${map.id} = :id`, { id, updated: timestamp });
  await execute('INSERT INTO audit_logs (log_id, entity_type, entity_id, action, actor, before_json, after_json, created_at) VALUES (:log, :type, :id, :action, :actor, :before, :after, :created)', { log: uuid(), type, id, action: 'DEACTIVATE', actor, before: JSON.stringify(publicRow(current)), after: JSON.stringify({ active: false }), created: timestamp });
  return { id };
}

function ownerLabel(bill) {
  const sourceName = clean(bill.source_user_name, 255);
  if (sourceName) return sourceName;
  const sourceUser = clean(bill.source_user_id, 120);
  if (sourceUser && !/^U[0-9a-f]{20,64}$/i.test(sourceUser)) return sourceUser;
  return clean(bill.source).toUpperCase() === 'LINE' ? 'ผู้ส่งผ่าน LINE' : 'เว็บแอป';
}

function aggregate(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const label = keyFn(row) || 'ไม่ระบุ';
    const entry = map.get(label) || { label, total: 0, count: 0 };
    entry.total += number(row.grand_total);
    entry.count += 1;
    map.set(label, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'th'));
}

export async function listBills(filters = {}) {
  const params = {};
  const where = [];
  if (filters.project_id) { where.push('b.project_id = :project'); params.project = clean(filters.project_id, 64); }
  if (filters.company_id) { where.push('b.company_id = :company'); params.company = clean(filters.company_id, 64); }
  if (filters.category_id) { where.push('b.category_id = :category'); params.category = clean(filters.category_id, 64); }
  if (filters.status) { where.push('b.status = :status'); params.status = clean(filters.status, 32); } else where.push("b.status <> 'REJECTED'");
  if (filters.date_from) { where.push('COALESCE(b.document_date, DATE(b.created_at)) >= :fromDate'); params.fromDate = clean(filters.date_from, 10); }
  if (filters.date_to) { where.push('COALESCE(b.document_date, DATE(b.created_at)) <= :toDate'); params.toDate = clean(filters.date_to, 10); }
  if (filters.year) { where.push("DATE_FORMAT(COALESCE(b.document_date, b.created_at), '%Y') = :year"); params.year = clean(filters.year, 4); }
  if (filters.month) { where.push("DATE_FORMAT(COALESCE(b.document_date, b.created_at), '%m') = :month"); params.month = clean(filters.month, 2).padStart(2, '0'); }
  if (filters.query) { where.push("LOWER(CONCAT_WS(' ', b.document_no, b.vendor_name, b.vendor_tax_id, b.buyer_name, b.description, b.notes, b.source_user_id, b.source_user_name, p.project_name, co.company_name, c.category_name)) LIKE :query"); params.query = `%${clean(filters.query, 180).toLowerCase()}%`; }
  const from = `FROM bills b LEFT JOIN projects p ON p.project_id=b.project_id LEFT JOIN companies co ON co.company_id=b.company_id LEFT JOIN categories c ON c.category_id=b.category_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const count = await one(`SELECT COUNT(*) AS total ${from}`, params);
  const allowedSorts = new Set(['document_date','created_at','grand_total','vendor_name','status','document_no']);
  const sort = allowedSorts.has(filters.sort_by) ? filters.sort_by : 'document_date';
  const direction = filters.sort_dir === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.max(10, Math.min(100, Number(filters.page_size) || 25));
  const pages = Math.max(1, Math.ceil(Number(count.total) / pageSize));
  const page = Math.max(1, Math.min(pages, Number(filters.page) || 1));
  params.limit = pageSize;
  params.offset = (page - 1) * pageSize;
  const rows = await select(`SELECT b.*, p.project_name, co.company_name, c.category_name ${from} ORDER BY b.${sort} ${direction}, b.created_at DESC LIMIT :limit OFFSET :offset`, params);
  return { rows: rows.map(enrichBill), total: Number(count.total), page, pageSize, pages };
}

export async function getDashboard(filters = {}) {
  const period = normalizePeriod(filters.period);
  const all = (await select("SELECT b.*, p.project_name, c.category_name FROM bills b LEFT JOIN projects p ON p.project_id=b.project_id LEFT JOIN categories c ON c.category_id=b.category_id WHERE b.status <> 'REJECTED' ORDER BY b.document_date DESC, b.created_at DESC")).map(enrichBill);
  const periodRows = all.filter(row => String(row.document_date || row.created_at).slice(0, 7) === period);
  const ownerOptions = aggregate(periodRows, ownerLabel);
  const available = ownerOptions.map(item => item.label);
  const viewMode = filters.view_mode === 'person' ? 'person' : 'overall';
  const selectedOwners = viewMode === 'person' ? (Array.isArray(filters.owners) ? filters.owners : available).filter(owner => available.includes(owner)) : [];
  const rows = viewMode === 'person' ? all.filter(row => selectedOwners.includes(ownerLabel(row))) : all;
  const selectedPeriodRows = rows.filter(row => String(row.document_date || row.created_at).slice(0, 7) === period);
  const currentYear = period.slice(0, 4);
  const month = Number(period.slice(5));
  const previousPeriod = month === 1 ? `${Number(currentYear)-1}-12` : `${currentYear}-${String(month-1).padStart(2,'0')}`;
  const totalOf = data => data.reduce((sum, row) => sum + number(row.grand_total), 0);
  const previousRows = rows.filter(row => String(row.document_date || row.created_at).slice(0,7) === previousPeriod);
  const previousProjects = aggregate(previousRows, row => row.project_name || 'ไม่ระบุโครงการ').map(item => ({ project_name: item.label, total: item.total }));
  const uploaderSummary = aggregate(selectedPeriodRows, ownerLabel);
  const ownerCategories = new Map();
  for (const row of selectedPeriodRows) {
    const owner = ownerLabel(row); const category = row.category_name || 'ยังไม่จัดกลุ่ม';
    const value = ownerCategories.get(owner) || { label: owner, count: 0, total: 0, categories: new Map() };
    value.count += 1; value.total += number(row.grand_total);
    const cat = value.categories.get(category) || { label: category, count: 0, total: 0 };
    cat.count += 1; cat.total += number(row.grand_total); value.categories.set(category, cat); ownerCategories.set(owner, value);
  }
  const personBreakdowns = [...ownerCategories.values()].map(value => ({ ...value, categories: [...value.categories.values()].sort((a,b)=>b.total-a.total) })).sort((a,b)=>b.total-a.total);
  return {
    filters: { period, currentPeriod: new Date().toISOString().slice(0,7), viewMode, selectedOwners, ownersProvided: Array.isArray(filters.owners) },
    ownerOptions,
    summary: {
      currentMonth: { period, total: totalOf(selectedPeriodRows) },
      currentYear: { year: currentYear, total: totalOf(rows.filter(row => String(row.document_date || row.created_at).slice(0,4) === currentYear)) },
      previousMonth: { period: previousPeriod, total: totalOf(previousRows), projects: previousProjects },
      reviewCount: rows.filter(row => ['NEEDS_REVIEW','PENDING_CONFIRMATION'].includes(row.status)).length,
    },
    totals: { total: totalOf(rows), vat: rows.reduce((sum,row)=>sum+number(row.vat_amount),0), count: rows.length, review: rows.filter(row=>['NEEDS_REVIEW','PENDING_CONFIRMATION'].includes(row.status)).length },
    byMonth: aggregate(rows, row => String(row.document_date || row.created_at).slice(0,7)),
    byProject: aggregate(selectedPeriodRows, row => row.project_name || 'ไม่ระบุโครงการ'),
    byCategory: aggregate(selectedPeriodRows, row => row.category_name || 'ยังไม่จัดกลุ่ม'),
    uploaderSummary, personBreakdowns, bills: selectedPeriodRows.slice(0,50),
  };
}

export async function getBootstrapData(filters = {}) {
  const [masters, dashboard, pendingReviews, quickSettings] = await Promise.all([listMasterData(), getDashboard(filters), listPendingReviewBills(), getQuickSettings()]);
  return { app: { name: config.appName, version: config.appVersion, model: config.geminiModel, maxPages: config.maxPagesPerBill }, masters, dashboard, pendingReviews, quickSettings };
}

export async function listPendingReviewBills() {
  return (await select("SELECT bill_id, vendor_name, document_no, COALESCE(updated_at, created_at) AS updated_at FROM bills WHERE status IN ('NEEDS_REVIEW','PENDING_CONFIRMATION') ORDER BY updated_at DESC")).map(publicRow);
}

export async function getQuickSettings() {
  const rows = await select("SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'quick.%'");
  const values = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  const slots = [];
  for (const slot of [1, 2]) {
    const pageCount = Number(values[`quick.${slot}.page_count`] || 0);
    const projectId = values[`quick.${slot}.project_id`] || '';
    const companyId = values[`quick.${slot}.company_id`] || '';
    const [project, company] = await Promise.all([
      projectId ? one('SELECT project_name, active FROM projects WHERE project_id=:id', { id:projectId }) : null,
      companyId ? one('SELECT company_name, active FROM companies WHERE company_id=:id', { id:companyId }) : null,
    ]);
    const hasValues = !!(pageCount || projectId || companyId);
    const configured = pageCount >= 1 && pageCount <= config.maxPagesPerBill && bool(project?.active) && bool(company?.active);
    slots.push({ slot, label:`ค่าลัด ${slot}`, configured, has_values:hasValues, page_count:pageCount, project_id:projectId, project_name:project?.project_name||'', company_id:companyId, company_name:company?.company_name||'', message:configured?`ค่าลัด ${slot} พร้อมใช้ในหน้าเพิ่มบิล`:hasValues?'ค่าลัดเดิมใช้งานไม่ได้ กรุณาตรวจสอบจำนวนหน้า โครงการ และบริษัทใหม่':`ยังไม่ได้ตั้งค่าลัด ${slot}` });
  }
  const configured = slots.filter(item=>item.configured);
  const legacy = configured.find(item=>item.slot===1) || configured[0] || slots[0];
  return { ...legacy, slots, configured_count:configured.length, any_configured:configured.length>0, message:configured.length===2?'มีค่าลัดพร้อมใช้งานครบ 2 ชุด':configured.length===1?'มีค่าลัดพร้อมใช้งาน 1 ชุด':'ยังไม่ได้ตั้งค่าลัด' };
}

export async function saveQuickSettings(payload = {}) {
  const slot=Number(payload.slot)===2?2:1,pageCount=Number(payload.page_count),projectId=clean(payload.project_id,64),companyId=clean(payload.company_id,64);
  if(!Number.isInteger(pageCount)||pageCount<1||pageCount>config.maxPagesPerBill)throw apiError('INVALID_PAGE_COUNT',`จำนวนหน้าต้องอยู่ระหว่าง 1-${config.maxPagesPerBill}`);
  const [project,company]=await Promise.all([one('SELECT project_id FROM projects WHERE project_id=:id AND active=1',{id:projectId}),one('SELECT company_id FROM companies WHERE company_id=:id AND active=1',{id:companyId})]);
  if(!project)throw apiError('PROJECT_REQUIRED','กรุณาเลือกโครงการที่ยังใช้งานอยู่');if(!company)throw apiError('COMPANY_REQUIRED','กรุณาเลือกบริษัทที่ยังใช้งานอยู่');
  for (const [field,value] of Object.entries({page_count:pageCount,project_id:projectId,company_id:companyId})) await execute("INSERT INTO app_settings (setting_key, setting_value) VALUES (:key, :value) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)", { key:`quick.${slot}.${field}`, value:String(value) });
  return getQuickSettings();
}

export async function clearQuickSettings(slot) {
  const slotNumber=Number(slot)===2?2:1;
  await execute('DELETE FROM app_settings WHERE setting_key LIKE :prefix',{prefix:`quick.${slotNumber}.%`});
  return getQuickSettings();
}

export { enrichBill };
