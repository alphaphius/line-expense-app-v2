  const state = { masters: { projects: [], companies: [], categories: [], vendors: [], billOwners: [] }, dashboard: null, dashboardFilters: { period:'', view_mode:'overall', owners:null }, dashboardRequestId: 0, uploadRequestId: '', quickSettings: null, pendingReviews: [], reviewWorkflowActive: false, monthlyChart: null, billList: { rows: [], page: 1, pages: 1, total: 0 } };
  const viewTitles = { dashboard: 'ภาพรวมค่าใช้จ่าย', bills: 'บิลทั้งหมด', upload: 'เพิ่มบิล', masters: 'ตั้งค่าข้อมูล', receipts: 'เอกสารใบรับเงิน', payroll: 'สรุปค่าแรง', tasks: 'Task manager', system: 'สถานะระบบ' };
  const expenseViews = ['dashboard','bills','upload','masters','system'];
  const protectedViews = ['receipts','payroll','tasks'];

  function gas(method, ...args) {
    return window.V2Api.call(method, ...args);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function money(value) {
    return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(Number(value) || 0);
  }

  function thaiDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '-';
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const days = ['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์'];
    const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    return `${days[date.getUTCDay()]} ที่ ${day} ${months[month - 1]} ${year + 543}`;
  }

  async function bootstrap(filters) {
    const requestedFilters = filters && Object.keys(filters).length ? filters : dashboardRequestPayload_();
    const data = await gas('getBootstrapData', requestedFilters);
    if (!data || !data.masters || !data.dashboard) throw new Error('เซิร์ฟเวอร์ไม่ส่งข้อมูล Dashboard กรุณาอัปเดต deployment และลองใหม่');
    state.masters = data.masters;
    state.dashboard = data.dashboard;
    syncDashboardFilterState_(data.dashboard);
    state.quickSettings = data.quickSettings || { slots:[], configured_count:0, any_configured:false, message:'ยังไม่ได้ตั้งค่าลัด' };
    state.pendingReviews = Array.isArray(data.pendingReviews) ? data.pendingReviews : [];
    renderMasters(); renderFilters(); renderDashboard();
    document.getElementById('loading-screen').classList.add('hidden');
  }

  function switchView(view) {
    document.querySelectorAll('.app-view').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + view);
    if (!target) return;
    target.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    const product = expenseViews.indexOf(view) >= 0 ? 'expenses' : view;
    document.querySelectorAll('.product-nav__button').forEach(el => el.classList.toggle('active', el.dataset.product === product));
    document.getElementById('view-title').textContent = viewTitles[view];
    if (view === 'system') loadSystemStatus();
    if (view === 'bills') loadAllBills(1);
    if (view === 'receipts' && window.ReceiptModule) window.ReceiptModule.activate();
  }

  function renderFilters() {
    const now = new Date();
    const exportMonth = document.getElementById('export-month');
    if (!exportMonth.value) exportMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`;
    setOptions('upload-project', state.masters.projects, 'project_id', 'project_name', 'เลือกโครงการ');
    setOptions('upload-company', state.masters.companies, 'company_id', 'company_name', 'เลือกบริษัท');
    setOptions('upload-owner', state.masters.billOwners || [], 'user_id', 'display_name', (state.masters.billOwners || []).length ? 'เลือกเจ้าของบิล' : 'ยังไม่มีรายชื่อจาก LINE');
    if ((state.masters.billOwners || []).length === 1) document.getElementById('upload-owner').value = state.masters.billOwners[0].user_id;
    [1, 2].forEach(slot => {
      setOptions(`quick-project-${slot}`, state.masters.projects, 'project_id', 'project_name', 'เลือกโครงการ');
      setOptions(`quick-company-${slot}`, state.masters.companies, 'company_id', 'company_name', 'เลือกบริษัท');
    });
    setOptions('bill-project-filter', state.masters.projects, 'project_id', 'project_name', 'ทุกโครงการ', true);
    setOptions('bill-company-filter', state.masters.companies, 'company_id', 'company_name', 'ทุกบริษัท', true);
    setOptions('bill-category-filter', state.masters.categories, 'category_id', 'category_name', 'ทุกหมวด', true);
    renderQuickSettings();
  }

  function setOptions(id, rows, valueKey, labelKey, placeholder, preserve) {
    const element = document.getElementById(id);
    const selected = preserve ? element.value : '';
    element.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + rows.map(row => `<option value="${escapeHtml(row[valueKey])}">${escapeHtml(row[labelKey])}</option>`).join('');
    if (selected) element.value = selected;
  }

  function renderDashboard() {
    const data = state.dashboard;
    renderDashboardControls(data);
    const summary = data.summary || {};
    const currentMonth = summary.currentMonth || {};
    const currentYear = summary.currentYear || {};
    const previousMonth = summary.previousMonth || {};
    const reviewCount = Number(summary.reviewCount != null ? summary.reviewCount : data.totals.review) || 0;
    document.getElementById('metric-current-month').textContent = money(currentMonth.total);
    document.getElementById('metric-current-year').textContent = money(currentYear.total);
    document.getElementById('metric-previous-month').textContent = money(previousMonth.total);
    document.getElementById('metric-review').textContent = reviewCount.toLocaleString('th-TH');
    document.getElementById('metric-current-month-label').textContent = thaiMonthPeriod(currentMonth.period);
    document.getElementById('metric-current-year-label').textContent = currentYear.year ? `ปี ${Number(currentYear.year) + 543}` : 'ปีปัจจุบัน';
    document.getElementById('previous-month-label').textContent = thaiMonthPeriod(previousMonth.period);
    const projectRows = Array.isArray(previousMonth.projects) ? previousMonth.projects : [];
    document.getElementById('previous-month-projects').innerHTML = projectRows.length ? projectRows.map(project => `
      <div class="previous-project-row">
        <span>${escapeHtml(project.project_name)}</span>
        <strong>${money(project.total)}</strong>
      </div>`).join('') : '<p class="previous-project-empty">เดือนก่อนยังไม่มีรายการที่แยกตามโครงการ</p>';
    renderMonthlyHistoryChart(data.byMonth);
    renderUploaderSummary(data.uploaderSummary);
    renderPersonBreakdowns(data.personBreakdowns);
    const personMode = state.dashboardFilters.view_mode === 'person';
    document.getElementById('uploader-summary-card').classList.toggle('hidden', personMode);
    document.getElementById('person-breakdown-card').classList.toggle('hidden', !personMode);
    document.getElementById('uploader-summary-period').textContent = thaiMonthPeriod(currentMonth.period);
    document.getElementById('person-breakdown-period').textContent = thaiMonthPeriod(currentMonth.period);
    document.getElementById('dashboard-bill-list-title').textContent = `รายการบิล ${thaiMonthPeriod(currentMonth.period)}`;
    const selectedOwnerCount = Array.isArray((data.filters || {}).selectedOwners) ? data.filters.selectedOwners.length : 0;
    document.getElementById('dashboard-bill-list-helper').textContent = personMode
      ? `แสดง ${selectedOwnerCount.toLocaleString('th-TH')} คน เรียงวันที่ในบิลใหม่สุดก่อน`
      : 'แสดงเจ้าของบิลทุกคน เรียงวันที่ในบิลใหม่สุดก่อน';
    const reviewInbox = document.getElementById('review-inbox');
    reviewInbox.classList.toggle('hidden', reviewCount < 1);
    document.getElementById('review-inbox-count').textContent = reviewCount.toLocaleString('th-TH');
    document.getElementById('bill-table').innerHTML = data.bills.length ? data.bills.map(bill => `
      <tr><td>${escapeHtml(thaiDate(bill.document_date))}</td><td><div class="font-medium">${escapeHtml(bill.vendor_name || '-')}</div><div class="text-xs text-slate-400">${escapeHtml(bill.document_no || '')}</div></td>
      <td>${escapeHtml(bill.project_name)}</td><td>${escapeHtml(bill.category_name)}</td><td>${escapeHtml(bill.source_user_name || bill.source_user_id || (bill.source === 'LINE' ? 'LINE User' : 'เว็บแอป'))}</td><td class="font-medium">${money(bill.grand_total)}</td>
      <td>${statusBadge(bill.status)}</td><td><button class="text-emerald-700" data-bill="${escapeHtml(bill.bill_id)}">ดู/แก้ไข</button></td></tr>`).join('')
      : `<tr><td colspan="8" class="py-10 text-center text-slate-400">ไม่พบบิลใน ${escapeHtml(thaiMonthPeriod(currentMonth.period))} ตามตัวกรองที่เลือก</td></tr>`;
  }

  function dashboardRequestPayload_() {
    return {
      period: state.dashboardFilters.period || '',
      view_mode: state.dashboardFilters.view_mode || 'overall',
      owners: state.dashboardFilters.view_mode === 'person' ? state.dashboardFilters.owners : null,
    };
  }

  function syncDashboardFilterState_(dashboard) {
    const filters = (dashboard && dashboard.filters) || {};
    state.dashboardFilters.period = filters.period || state.dashboardFilters.period;
    state.dashboardFilters.view_mode = filters.viewMode === 'person' ? 'person' : 'overall';
    if (state.dashboardFilters.view_mode === 'person') {
      state.dashboardFilters.owners = Array.isArray(filters.selectedOwners) ? filters.selectedOwners.slice() : [];
    }
  }

  function renderDashboardControls(data) {
    const filters = data.filters || {};
    const periodInput = document.getElementById('dashboard-month');
    periodInput.value = filters.period || '';
    periodInput.max = filters.currentPeriod || '';
    document.querySelectorAll('[data-dashboard-mode]').forEach(button => {
      const active = button.dataset.dashboardMode === state.dashboardFilters.view_mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const personMode = state.dashboardFilters.view_mode === 'person';
    const ownerPanel = document.getElementById('dashboard-owner-filter');
    ownerPanel.classList.toggle('hidden', !personMode);
    const selected = new Set(Array.isArray(filters.selectedOwners) ? filters.selectedOwners : []);
    const ownerOptions = Array.isArray(data.ownerOptions) ? data.ownerOptions : [];
    document.getElementById('dashboard-owner-options').innerHTML = ownerOptions.length ? ownerOptions.map(owner => `
      <label class="dashboard-owner-option">
        <input type="checkbox" value="${escapeHtml(owner.label)}" data-dashboard-owner ${selected.has(owner.label) ? 'checked' : ''}>
        <span><strong>${escapeHtml(owner.label || 'ไม่ทราบชื่อ')}</strong><small>${Number(owner.count || 0).toLocaleString('th-TH')} บิล · ${money(owner.total)}</small></span>
      </label>`).join('') : '<p class="dashboard-owner-empty">เดือนนี้ยังไม่มีข้อมูลเจ้าของบิล</p>';
    document.getElementById('dashboard-filter-feedback').textContent = personMode
      ? (selected.size ? `กำลังแสดง ${selected.size.toLocaleString('th-TH')} คน ใน ${thaiMonthPeriod(filters.period)}` : `ยังไม่ได้เลือกเจ้าของบิลใน ${thaiMonthPeriod(filters.period)}`)
      : `กำลังแสดงภาพรวมทุกคนใน ${thaiMonthPeriod(filters.period)}`;
    document.getElementById('dashboard-next-month').disabled = !filters.period || filters.period >= filters.currentPeriod;
  }

  function setDashboardRefreshing(active) {
    const view = document.getElementById('view-dashboard');
    view.classList.toggle('is-refreshing', active);
    view.setAttribute('aria-busy', String(active));
    ['dashboard-prev-month','dashboard-month','dashboard-owner-select-all','dashboard-owner-clear'].forEach(id => {
      const control = document.getElementById(id);
      if (control) control.disabled = active;
    });
    document.querySelectorAll('[data-dashboard-mode],[data-dashboard-owner]').forEach(control => { control.disabled = active; });
    if (!active && state.dashboard && state.dashboard.filters) {
      document.getElementById('dashboard-next-month').disabled = state.dashboard.filters.period >= state.dashboard.filters.currentPeriod;
    } else {
      document.getElementById('dashboard-next-month').disabled = active;
    }
  }

  async function refreshDashboard(nextFilters) {
    state.dashboardFilters = Object.assign({}, state.dashboardFilters, nextFilters || {});
    const requestId = ++state.dashboardRequestId;
    setDashboardRefreshing(true);
    try {
      const dashboard = await gas('getDashboard', dashboardRequestPayload_());
      if (requestId !== state.dashboardRequestId) return;
      state.dashboard = dashboard;
      syncDashboardFilterState_(dashboard);
      renderDashboard();
    } catch (error) {
      if (requestId === state.dashboardRequestId) await Swal.fire({ icon:'error', title:'ปรับตัวกรองไม่สำเร็จ', text:error.message, confirmButtonColor:'#8f5f42' });
    } finally {
      if (requestId === state.dashboardRequestId) setDashboardRefreshing(false);
    }
  }

  function shiftDashboardPeriod(period, offset) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
    const base = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : new Date();
    base.setUTCMonth(base.getUTCMonth() + offset);
    return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2,'0')}`;
  }

  function selectedDashboardOwnersFromUi() {
    return Array.from(document.querySelectorAll('[data-dashboard-owner]:checked')).map(input => input.value);
  }

  let dashboardOwnerFilterTimer = null;
  function scheduleDashboardOwnerRefresh() {
    clearTimeout(dashboardOwnerFilterTimer);
    state.dashboardFilters.owners = selectedDashboardOwnersFromUi();
    document.getElementById('dashboard-filter-feedback').textContent = 'กำลังปรับข้อมูลตามเจ้าของบิลที่เลือก...';
    dashboardOwnerFilterTimer = setTimeout(() => refreshDashboard({ owners:state.dashboardFilters.owners }), 320);
  }

  function renderUploaderSummary(rows) {
    const target = document.getElementById('uploader-summary-bars');
    const uploaderRows = Array.isArray(rows) ? rows : [];
    if (!uploaderRows.length) {
      target.innerHTML = '<p class="uploader-summary-empty">เดือนนี้ยังไม่มีข้อมูลผู้ส่งบิล</p>';
      return;
    }
    const maximumTotal = Math.max(...uploaderRows.map(row => Number(row.total) || 0), 0);
    target.innerHTML = uploaderRows.map(row => {
      const total = Number(row.total) || 0;
      const width = maximumTotal > 0 && total > 0 ? Math.max(4, (total / maximumTotal) * 100) : 0;
      const count = Number(row.count) || 0;
      return `<div class="uploader-bar-row" title="${escapeHtml(`${row.label}: ${count} ชุด รวม ${money(total)}`)}">
        <div class="uploader-bar-meta">
          <strong>${escapeHtml(row.label || 'ไม่ทราบชื่อ')}</strong>
          <span>${count.toLocaleString('th-TH')} ชุด</span>
        </div>
        <div class="uploader-bar-data">
          <div class="uploader-bar-track" aria-hidden="true"><span class="uploader-bar-fill" style="width:${width.toFixed(2)}%"></span></div>
          <span class="uploader-bar-total">${money(total)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function renderPersonBreakdowns(rows) {
    const target = document.getElementById('person-breakdown-list');
    const people = Array.isArray(rows) ? rows : [];
    if (!people.length) {
      target.innerHTML = '<p class="person-breakdown-empty">ไม่พบค่าใช้จ่ายของบุคคลที่เลือกในเดือนนี้</p>';
      return;
    }
    target.innerHTML = people.map(person => {
      const categories = Array.isArray(person.categories) ? person.categories : [];
      const total = Number(person.total) || 0;
      const categoryRows = categories.map(category => {
        const amount = Number(category.total) || 0;
        const width = total > 0 ? Math.max(3, (amount / total) * 100) : 0;
        return `<div class="person-category-row">
          <div class="person-category-copy"><span>${escapeHtml(category.label)}</span><small>${Number(category.count || 0).toLocaleString('th-TH')} บิล</small></div>
          <div class="person-category-value"><strong>${money(amount)}</strong><span aria-hidden="true" style="width:${width.toFixed(2)}%"></span></div>
        </div>`;
      }).join('');
      return `<section class="person-breakdown-panel" aria-label="สรุปค่าใช้จ่ายของ ${escapeHtml(person.label)}">
        <header><div><h4>${escapeHtml(person.label)}</h4><p>${Number(person.count || 0).toLocaleString('th-TH')} บิล</p></div><strong>${money(total)}</strong></header>
        <div class="person-category-list">${categoryRows || '<p class="person-breakdown-empty">ยังไม่มีข้อมูลหมวดหมู่</p>'}</div>
      </section>`;
    }).join('');
  }

  function thaiMonthPeriod(period) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
    if (!match) return 'ยังไม่มีช่วงเวลา';
    const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    return `${months[Number(match[2]) - 1]} ${Number(match[1]) + 543}`;
  }

  function thaiMonthShortPeriod(period) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
    if (!match) return String(period || '-');
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${months[Number(match[2]) - 1]} ${String(Number(match[1]) + 543).slice(-2)}`;
  }

  function renderMonthlyHistoryChart(rows) {
    const chartRows = Array.isArray(rows) ? rows.filter(row => /^\d{4}-\d{2}$/.test(String(row.label || ''))) : [];
    const scroll = document.getElementById('monthly-chart-scroll');
    const empty = document.getElementById('monthly-chart-empty');
    const canvasWrap = document.getElementById('monthly-chart-canvas-wrap');
    if (state.monthlyChart) {
      state.monthlyChart.destroy();
      state.monthlyChart = null;
    }
    const canRender = chartRows.length > 0 && window.Chart;
    scroll.classList.toggle('hidden', !canRender);
    empty.classList.toggle('hidden', !!canRender);
    empty.textContent = chartRows.length ? 'โหลดส่วนแสดงกราฟไม่สำเร็จ กรุณารีเฟรชอีกครั้ง' : 'ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟรายเดือน';
    if (!canRender) return;
    canvasWrap.style.minWidth = `${Math.max(720, chartRows.length * 76)}px`;
    state.monthlyChart = new Chart(document.getElementById('monthly-history-chart'), {
      type: 'line',
      data: {
        labels: chartRows.map(row => thaiMonthShortPeriod(row.label)),
        datasets: [{
          label: 'ยอดรวม',
          data: chartRows.map(row => Number(row.total) || 0),
          borderColor: '#9a6244',
          backgroundColor: 'rgba(198,154,91,.16)',
          pointBackgroundColor: '#754631',
          pointBorderColor: '#fffdf9',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2.5,
          fill: true,
          tension: .32,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: context => ` ${money(context.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#78675d', maxRotation: 0, autoSkip: false } },
          y: { beginAtZero: true, grid: { color: 'rgba(231,217,202,.65)' }, ticks: { color: '#78675d', callback: value => Number(value).toLocaleString('th-TH') } },
        },
      },
    });
    requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });
  }

  async function loadAllBills(page = 1) {
    const [sortBy, sortDir] = (document.getElementById('bill-sort').value || 'document_date:desc').split(':');
    const filters = Object.assign(currentBillFilters(), {
      page, page_size: 25, query: document.getElementById('bill-search').value,
      sort_by: sortBy, sort_dir: sortDir,
    });
    try {
      state.billList = await gas('listBills', filters);
      renderAllBills();
    } catch (error) { Swal.fire({ icon:'error', title:'โหลดรายการไม่สำเร็จ', text:error.message }); }
  }

  function currentBillFilters() {
    return {
      status: document.getElementById('bill-status').value,
      project_id: document.getElementById('bill-project-filter').value,
      company_id: document.getElementById('bill-company-filter').value,
      category_id: document.getElementById('bill-category-filter').value,
      date_from: document.getElementById('bill-date-from').value,
      date_to: document.getElementById('bill-date-to').value,
    };
  }

  function renderAllBills() {
    const data = state.billList;
    document.getElementById('bill-list-count').textContent = `${Number(data.total || 0).toLocaleString('th-TH')} รายการ`;
    document.getElementById('bill-page-info').textContent = `หน้า ${data.page || 1}/${data.pages || 1}`;
    document.getElementById('bill-prev').disabled = data.page <= 1;
    document.getElementById('bill-next').disabled = data.page >= data.pages;
    document.getElementById('all-bills-table').innerHTML = data.rows.length ? data.rows.map(bill => `
      <tr class="hover:bg-slate-50"><td>${escapeHtml(thaiDate(bill.document_date))}</td>
      <td><button class="text-left font-medium text-emerald-700 hover:underline" data-bill="${escapeHtml(bill.bill_id)}">${escapeHtml(bill.vendor_name || 'ไม่ทราบร้านค้า')}</button><div class="text-xs text-slate-400">${escapeHtml(bill.document_no || '-')}</div></td>
      <td>${escapeHtml(bill.project_name)}</td><td class="max-w-52 truncate" title="${escapeHtml(bill.company_name)}">${escapeHtml(bill.company_name)}</td><td>${escapeHtml(bill.category_name)}</td>
      <td>${escapeHtml(bill.source_user_name || bill.source_user_id || '-')}</td><td class="font-medium">${money(bill.grand_total)}</td><td>${statusBadge(bill.status)}</td>
      <td><div class="flex items-center gap-2"><button class="rounded-lg border border-slate-200 px-3 py-1 text-xs" data-bill="${escapeHtml(bill.bill_id)}">รายละเอียด</button>${bill.status === 'REJECTED' ? `<button class="rounded-lg border border-amber-200 px-3 py-1 text-xs text-amber-700" data-restore-bill="${escapeHtml(bill.bill_id)}">กู้คืน</button>` : `<button class="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600" data-delete-bill="${escapeHtml(bill.bill_id)}">ลบ</button>`}</div></td></tr>`).join('')
      : '<tr><td colspan="9" class="py-12 text-center text-slate-400">ไม่พบรายการตามเงื่อนไข</td></tr>';
  }

  function statusBadge(status) {
    const labels = { CONFIRMED: ['ยืนยันแล้ว','bg-emerald-100 text-emerald-700'], NEEDS_REVIEW: ['ตรวจสอบ','bg-amber-100 text-amber-700'], PENDING_CONFIRMATION: ['รอยืนยัน','bg-blue-100 text-blue-700'], REJECTED: ['ยกเลิกแล้ว','bg-red-100 text-red-700'] };
    const item = labels[status] || [status || '-', 'bg-slate-100 text-slate-600'];
    return `<span class="rounded-full px-2 py-1 text-xs ${item[1]}">${item[0]}</span>`;
  }

  function renderMasters() {
    renderMasterList('project-list', 'project', state.masters.projects, row => [row.project_name, row.project_code]);
    renderMasterList('company-list', 'company', state.masters.companies, row => [row.company_name, row.tax_id]);
    renderMasterList('category-list', 'category', state.masters.categories, row => [row.category_name, row.aliases]);
    document.getElementById('vendor-tags').innerHTML = state.masters.vendors.length ? state.masters.vendors.slice(0, 100).map(v => `<span class="rounded-full bg-slate-100 px-3 py-1 text-xs">${escapeHtml(v.vendor_name)} (${Number(v.use_count) || 0})</span>`).join('') : '<span class="text-sm text-slate-400">ยังไม่มีรายชื่อ</span>';
    document.getElementById('vendor-suggestions').innerHTML = state.masters.vendors.map(v => `<option value="${escapeHtml(v.vendor_name)}"></option>`).join('');
  }

  function quickSettingSlots() {
    const quick = state.quickSettings || {};
    const source = Array.isArray(quick.slots) ? quick.slots : [Object.assign({ slot:1, label:'ค่าลัด 1' }, quick)];
    return [1, 2].map(slot => source.find(item => Number(item.slot) === slot) || {
      slot, label:`ค่าลัด ${slot}`, configured:false, has_values:false, page_count:0,
      project_id:'', project_name:'', company_id:'', company_name:'', message:`ยังไม่ได้ตั้งค่าลัด ${slot}`,
    });
  }

  function quickSettingBySlot(slot) {
    return quickSettingSlots().find(item => Number(item.slot) === Number(slot));
  }

  function renderQuickSettings() {
    const slots = quickSettingSlots();
    slots.forEach(quick => {
      const slot = quick.slot;
      document.getElementById(`quick-page-count-${slot}`).value = quick.page_count >= 1 ? String(quick.page_count) : '1';
      document.getElementById(`quick-project-${slot}`).value = quick.project_id || '';
      document.getElementById(`quick-company-${slot}`).value = quick.company_id || '';
      const status = document.getElementById(`quick-settings-status-${slot}`);
      status.classList.toggle('is-ready', !!quick.configured);
      status.classList.toggle('is-warning', !!quick.has_values && !quick.configured);
      status.textContent = quick.configured
        ? `พร้อมใช้งาน · ${quick.page_count} หน้า · ${quick.project_name} · ${quick.company_name}`
        : (quick.message || `ยังไม่ได้ตั้งค่าลัด ${slot}`);
    });
    const configured = slots.filter(quick => quick.configured);
    const uploadPreset = document.getElementById('upload-quick-preset');
    uploadPreset.classList.toggle('hidden', configured.length === 0);
    document.getElementById('upload-quick-options').innerHTML = configured.map(quick => `
      <button class="upload-quick-option" type="button" data-apply-upload-quick="${quick.slot}">
        <strong>${escapeHtml(quick.label)}</strong>
        <span>${escapeHtml(`${quick.page_count} หน้า · ${quick.project_name} · ${quick.company_name}`)}</span>
      </button>`).join('');
    if (configured.length && document.getElementById('bill-files').files.length === 0) {
      applyQuickSettingsToUpload(configured[0].slot, false);
    }
  }

  function applyQuickSettingsToUpload(slotNumber, showFeedback = true) {
    const quick = quickSettingBySlot(slotNumber);
    if (!quick || !quick.configured) {
      if (showFeedback) Swal.fire({ icon:'info', title:'ค่าลัดนี้ยังไม่พร้อม', text:'ตั้งค่าได้ที่หน้า “ตั้งค่าข้อมูล”' });
      return;
    }
    document.getElementById('upload-project').value = quick.project_id;
    document.getElementById('upload-company').value = quick.company_id;
    document.getElementById('expected-pages').value = quick.page_count;
    if (showFeedback) showActivityToast(`ใช้${quick.label} แล้ว`, `${quick.page_count} หน้า · ${quick.project_name}`, 'success');
  }

  async function saveQuickSettingsFromWeb(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const slot = Number(form.dataset.quickSlot) === 2 ? 2 : 1;
    const button = form.querySelector('button[type="submit"]');
    const payload = {
      slot,
      page_count: document.getElementById(`quick-page-count-${slot}`).value,
      project_id: document.getElementById(`quick-project-${slot}`).value,
      company_id: document.getElementById(`quick-company-${slot}`).value,
    };
    button.disabled = true;
    showActivityToast(`กำลังบันทึกค่าลัด ${slot}…`, 'ตรวจสอบโครงการและบริษัทอยู่');
    try {
      state.quickSettings = await gas('saveQuickSettings', payload);
      renderQuickSettings();
      showActivityToast(`บันทึกค่าลัด ${slot} แล้ว`, 'พร้อมใช้ในหน้าเพิ่มบิล', 'success');
    } catch (error) {
      hideActivityToast();
      Swal.fire({ icon:'error', title:'บันทึกค่าลัดไม่สำเร็จ', text:error.message });
    } finally {
      button.disabled = false;
    }
  }

  async function clearQuickSettingsFromWeb(event) {
    const slot = Number(event.currentTarget.dataset.clearQuickSlot) === 2 ? 2 : 1;
    const confirm = await Swal.fire({
      icon:'warning', title:`ล้างค่าลัด ${slot}?`, text:'ค่าลัดอีกชุดจะยังใช้งานได้ตามปกติ',
      showCancelButton:true, confirmButtonText:'ล้างค่าลัด', cancelButtonText:'ยกเลิก', confirmButtonColor:'#a55343',
    });
    if (!confirm.isConfirmed) return;
    showActivityToast(`กำลังล้างค่าลัด ${slot}…`, 'การตั้งค่าในบิลเดิมจะไม่เปลี่ยน');
    try {
      state.quickSettings = await gas('clearQuickSettings', slot);
      renderQuickSettings();
      showActivityToast(`ล้างค่าลัด ${slot} แล้ว`, 'ค่าลัดชุดอื่นยังพร้อมใช้งาน', 'success');
    } catch (error) {
      hideActivityToast();
      Swal.fire({ icon:'error', title:'ล้างค่าลัดไม่สำเร็จ', text:error.message });
    }
  }

  function renderMasterList(id, type, rows, labels) {
    document.getElementById(id).innerHTML = rows.map(row => {
      const map = { project: 'project_id', company: 'company_id', category: 'category_id' };
      const [title, detail] = labels(row);
      return `<div class="master-row"><div><p class="text-sm font-medium">${escapeHtml(title)}</p><p class="mt-1 text-xs text-slate-400">${escapeHtml(detail || '')}</p></div><div class="flex gap-2"><button class="text-xs text-blue-600" data-edit="${type}" data-id="${row[map[type]]}">แก้ไข</button><button class="text-xs text-red-500" data-delete="${type}" data-id="${row[map[type]]}">ลบ</button></div></div>`;
    }).join('');
  }

  function masterFormHtml(type, row = {}) {
    if (type === 'project') return fieldHtml('project_name','ชื่อโครงการ',row.project_name) + fieldHtml('project_code','รหัสโครงการ',row.project_code) + textAreaHtml('description','รายละเอียด',row.description);
    if (type === 'company') return fieldHtml('company_name','ชื่อบริษัท',row.company_name) + fieldHtml('branch_name','สาขา',row.branch_name) + taxIdFieldHtml('tax_id','เลขผู้เสียภาษี 13 หลัก',row.tax_id) + textAreaHtml('address','ที่อยู่',row.address);
    return fieldHtml('category_name','ชื่อหมวดหมู่',row.category_name) + textAreaHtml('aliases','คำค้น/ชื่อใกล้เคียง คั่นด้วย comma',row.aliases);
  }

  function fieldHtml(id, label, value = '', type = 'text') { return `<label class="mb-3 block text-left text-sm">${label}<input id="sw-${id}" type="${type}" class="swal2-input !mx-0 !mt-1 !w-full" value="${escapeHtml(value)}"></label>`; }
  function taxIdFieldHtml(id, label, value = '') { return `<label class="mb-3 block text-left text-sm">${label}<input id="sw-${id}" type="text" inputmode="numeric" maxlength="13" pattern="[0-9]{13}" autocomplete="off" class="swal2-input !mx-0 !mt-1 !w-full" value="${escapeHtml(value)}" placeholder="0XXXXXXXXXXXX"><small class="mt-1 block text-xs text-slate-400">ต้องมี 13 หลัก รวมเลข 0 ด้านหน้า</small></label>`; }
  function textAreaHtml(id, label, value = '') { return `<label class="mb-3 block text-left text-sm">${label}<textarea id="sw-${id}" class="swal2-textarea !mx-0 !mt-1 !w-full">${escapeHtml(value)}</textarea></label>`; }

  async function openMasterForm(type, row = {}) {
    const result = await Swal.fire({ title: row[`${type}_id`] ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล', html: masterFormHtml(type, row), showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#059669', width: 600, preConfirm: () => {
      const payload = { ...row };
      document.querySelectorAll('[id^="sw-"]').forEach(el => payload[el.id.slice(3)] = el.value);
      const nameKey = { project:'project_name', company:'company_name', category:'category_name' }[type];
      if (!payload[nameKey].trim()) return Swal.showValidationMessage('กรุณากรอกชื่อ');
      if (type === 'company') {
        payload.tax_id = String(payload.tax_id || '').replace(/\D/g, '');
        if (!/^\d{13}$/.test(payload.tax_id)) return Swal.showValidationMessage('เลขผู้เสียภาษีต้องมี 13 หลัก และใส่เลข 0 ด้านหน้าได้');
      }
      return payload;
    }});
    if (!result.isConfirmed) return;
    await runBusy(() => gas('saveMasterData', type, result.value), 'กำลังบันทึก…');
    await bootstrap();
    Swal.fire({ icon:'success', title:'บันทึกแล้ว', timer:1200, showConfirmButton:false });
  }

  async function deleteMaster(type, id) {
    const confirm = await Swal.fire({ icon:'warning', title:'ลบรายการนี้?', text:'ข้อมูลเก่าจะยังอ้างอิงได้ แต่รายการจะไม่แสดงให้เลือกใหม่', showCancelButton:true, confirmButtonText:'ลบ', cancelButtonText:'ยกเลิก', confirmButtonColor:'#dc2626' });
    if (!confirm.isConfirmed) return;
    await gas('deleteMasterData', type, id); await bootstrap();
  }

  function previewFiles() {
    const files = [...document.getElementById('bill-files').files];
    state.uploadRequestId = '';
    document.getElementById('expected-pages').value = files.length || 1;
    document.getElementById('file-list').innerHTML = files.map((file, index) => `<div class="rounded-xl bg-slate-100 p-3 text-sm"><span class="font-medium">หน้า ${index + 1}</span><p class="truncate text-xs text-slate-500">${escapeHtml(file.name)} · ${(file.size/1048576).toFixed(2)} MB</p></div>`).join('');
  }

  async function submitUpload(event) {
    event.preventDefault();
    const files = [...document.getElementById('bill-files').files];
    const expected = Number(document.getElementById('expected-pages').value);
    const ownerId = document.getElementById('upload-owner').value;
    if (!ownerId) return Swal.fire('กรุณาเลือกเจ้าของบิล', 'รายชื่อจะสร้างเมื่อบุคคลนั้นเคยส่งบิลผ่าน LINE อย่างน้อยหนึ่งครั้ง', 'warning');
    if (files.length !== expected) return Swal.fire('จำนวนหน้าไม่ตรงกัน', `เลือก ${files.length} ไฟล์ แต่ระบุ ${expected} หน้า`, 'warning');
    if (files.some(file => file.size > 8 * 1024 * 1024)) return Swal.fire('ไฟล์ใหญ่เกินไป', 'ไฟล์ละไม่เกิน 8 MB', 'warning');
    const submitButton = event.submitter || event.currentTarget.querySelector('[type="submit"]');
    if (submitButton && submitButton.disabled) return;
    if (submitButton) { submitButton.disabled = true; submitButton.dataset.originalText = submitButton.textContent; submitButton.textContent = 'กำลังเตรียมรูป…'; }
    showActivityToast('กำลังบีบอัดรูป…', 'เตรียมไฟล์ให้เล็กลงก่อนอัปโหลด');
    try {
      if (!state.uploadRequestId) state.uploadRequestId = window.V2Api.newRequestId();
      const encodedFiles = await window.ImageOptimizer.prepareFiles(files, progress => {
        const detail = `เตรียมแล้ว ${progress.completed}/${progress.total} หน้า · ลดขนาด ${progress.savedPercent}%`;
        showActivityToast('กำลังบีบอัดรูป…', detail);
        if (submitButton) submitButton.textContent = `เตรียมรูป ${progress.completed}/${progress.total}`;
      });
      showActivityToast('กำลังวิเคราะห์บิล…', 'อัปโหลดไฟล์ขนาดเล็กและให้ Gemini อ่านข้อมูล');
      if (submitButton) submitButton.textContent = 'Gemini กำลังวิเคราะห์…';
      const bill = await window.V2Api.callWithRequestId('submitBillPages', state.uploadRequestId, {
        project_id: document.getElementById('upload-project').value,
        company_id: document.getElementById('upload-company').value,
        expected_pages: expected, files: encodedFiles, source: 'WEB', source_user_id: ownerId,
      });
      state.uploadRequestId = '';
      document.getElementById('upload-form').reset(); document.getElementById('file-list').innerHTML = ''; await bootstrap();
      await showBillResult(bill);
      hideActivityToast();
    } catch (error) {
      hideActivityToast();
      Swal.fire({ icon:'error', title:'วิเคราะห์ไม่สำเร็จ', text:error.message });
    } finally {
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = submitButton.dataset.originalText || 'วิเคราะห์บิลด้วย Gemini'; }
    }
  }

  async function showBillResult(bill, options = {}) {
    const isDeleted = bill.status === 'REJECTED';
    const needsReview = bill.needs_review === true || String(bill.needs_review).toLowerCase() === 'true';
    const warning = needsReview ? `<div class="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900"><strong class="block">จุดที่ควรตรวจสอบ</strong><span class="mt-1 block">${escapeHtml(bill.review_reasons || 'กรุณาตรวจสอบข้อมูลก่อน')}</span></div>` : '';
    const queueContext = options.queueMode ? `<div class="review-progress"><span>กำลังตรวจสอบรายการล่าสุด</span><strong>ค้างอีก ${Number(options.remainingCount || 1).toLocaleString('th-TH')} รายการ</strong></div>` : '';
    const result = await Swal.fire({ title:options.queueMode ? 'ตรวจสอบบิล' : 'รายละเอียดบิล', html: queueContext + warning + billSummaryHtml(bill), showConfirmButton:!isDeleted, showCancelButton:true, showDenyButton:!isDeleted, confirmButtonText:'ยืนยันบิลนี้', denyButtonText:'แก้ไขข้อมูล', cancelButtonText:options.queueMode ? 'ไว้ตรวจทีหลัง' : 'ปิด', confirmButtonColor:'#8f5f42', denyButtonColor:'#4b372f', width:1050, customClass:{ popup:'bill-review-modal', actions:'bill-review-actions' } });
    if (result.isConfirmed) {
      showActivityToast('กำลังยืนยันบิล…', 'บันทึกข้อมูลอยู่เบื้องหลัง คุณใช้งานส่วนอื่นต่อได้');
      try {
        await gas('confirmBill', bill.bill_id, 'WEB');
        await bootstrap();
        showActivityToast('ยืนยันบิลเรียบร้อย', options.queueMode ? 'กำลังเตรียมรายการถัดไป' : 'ข้อมูลถูกบันทึกแล้ว', 'success');
      } catch (error) {
        hideActivityToast();
        await Swal.fire({ icon:'error', title:'ยืนยันไม่สำเร็จ', text:error.message, confirmButtonColor:'#8f5f42' });
        return { action:'error', billId:bill.bill_id };
      }
      return { action:'confirmed', billId:bill.bill_id };
    }
    if (result.isDenied) return editBill(bill, options);
    return { action:'closed', billId:bill.bill_id };
  }

  function billSummaryHtml(bill) {
    const items = (bill.items || []).map(item => `<tr><td>${escapeHtml(item.line_no)}</td><td>${escapeHtml(item.description)}</td><td class="text-right">${Number(item.quantity)||0} ${escapeHtml(item.unit||'')}</td><td class="text-right">${money(item.unit_price)}</td><td class="text-right">${money(item.amount)}</td></tr>`).join('');
    const documents = (bill.documents || []).map(doc => `<button class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50" data-preview-doc="${escapeHtml(doc.doc_id)}">🧾 หน้า ${escapeHtml(doc.page_no || 1)} · ${escapeHtml(doc.file_name || 'ดูเอกสาร')}<small class="mt-1 block text-slate-400">${escapeHtml(doc.mime_type || 'ไม่ระบุชนิดไฟล์')} · ${doc.size_bytes ? (Number(doc.size_bytes)/1048576).toFixed(2)+' MB' : 'ไม่ระบุขนาด'}</small></button>`).join('');
    const check = value => value === true || String(value).toLowerCase() === 'true' ? '✅ ตรงกัน' : '⚠️ ไม่ตรง/อ่านไม่พบ';
    return `<div class="max-h-[65vh] space-y-4 overflow-y-auto pr-2 text-left text-sm">
      <section class="bill-review-summary"><div class="min-w-0"><p class="truncate text-lg font-semibold text-slate-900">${escapeHtml(bill.vendor_name || 'ไม่ทราบร้านค้า')}</p><p class="mt-1 text-sm text-slate-500">${escapeHtml(docTypeLabel(bill.doc_type))} · ${escapeHtml(bill.document_no || 'ไม่มีเลขที่เอกสาร')}</p><p class="mt-2 text-sm text-slate-600">${escapeHtml(thaiDate(bill.document_date))}</p></div><div class="text-right"><p class="text-xs font-medium text-slate-500">ยอดสุทธิ</p><p class="mt-1 text-2xl font-semibold text-emerald-700">${money(bill.grand_total)}</p><div class="mt-2">${statusBadge(bill.status)}</div></div></section>
      <section class="rounded-2xl bg-slate-50 p-4"><h4 class="mb-3 font-semibold text-slate-700">ข้อมูลเอกสาร</h4><div class="grid gap-3 sm:grid-cols-2">
        ${detailCell('ร้านค้า/ผู้ขาย',bill.vendor_name)}${detailCell('เลขที่เอกสาร',bill.document_no)}${detailCell('ประเภทเอกสาร',docTypeLabel(bill.doc_type))}${detailCell('วันที่เอกสาร',thaiDate(bill.document_date))}${detailCell('วันครบกำหนด',thaiDate(bill.due_date))}
        ${detailCell('โครงการ',bill.project_name)}${detailCell('หมวดบิล',bill.category_name)}${detailCell('บริษัทผู้ซื้อ',bill.company_name)}${detailCell('จำนวนหน้า',bill.page_count||1)}
      </div></section>
      <section class="rounded-2xl bg-slate-50 p-4"><h4 class="mb-3 font-semibold text-slate-700">ข้อมูลผู้ขายและผู้ซื้อ</h4><div class="grid gap-3 sm:grid-cols-2">
        ${detailCell('Tax ID ผู้ขาย',bill.vendor_tax_id)}${detailCell('สาขาผู้ขาย',bill.vendor_branch)}${detailCell('ที่อยู่ผู้ขาย',bill.vendor_address,true)}${detailCell('ชื่อผู้ซื้อบนบิล',bill.buyer_name)}
        ${detailCell('Tax ID ผู้ซื้อ',bill.buyer_tax_id)}${detailCell('ที่อยู่ผู้ซื้อบนบิล',bill.buyer_address,true)}
      </div></section>
      <section class="rounded-2xl bg-emerald-50 p-4"><h4 class="mb-3 font-semibold text-emerald-800">ยอดเงิน</h4><div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        ${detailCell('ยอดก่อนภาษี',money(bill.subtotal))}${detailCell('ส่วนลด',money(bill.discount))}${detailCell('อัตรา VAT',(Number(bill.vat_rate)||0)+'%')}${detailCell('VAT',money(bill.vat_amount))}${detailCell('ภาษีหัก ณ ที่จ่าย',money(bill.withholding_tax))}${detailCell('ยอดรวม',money(bill.grand_total))}
      </div></section>
      <section class="rounded-2xl bg-slate-50 p-4"><h4 class="mb-3 font-semibold text-slate-700">ผลตรวจสอบ</h4><div class="grid gap-3 sm:grid-cols-2">
        ${detailCell('ชื่อบริษัท',check(bill.company_match))}${detailCell('เลขผู้เสียภาษี',check(bill.tax_id_match))}${detailCell('ที่อยู่บริษัท',check(bill.address_match))}${detailCell('คุณภาพรูป',`${bill.image_quality||'-'} · ${Number(bill.quality_score)||0}%`)}
        ${detailCell('สถานะ',bill.status)}${detailCell('เหตุผลที่ต้องตรวจ',bill.review_reasons||'ไม่มี',true)}
      </div></section>
      <section class="rounded-2xl bg-slate-50 p-4"><h4 class="mb-3 font-semibold text-slate-700">รายละเอียดเพิ่มเติม</h4><div class="grid gap-3 sm:grid-cols-2">
        ${detailCell('คำอธิบาย',bill.description,true)}${detailCell('หมายเหตุ',bill.notes,true)}${detailCell('วิธีชำระเงิน',bill.payment_method)}${detailCell('สกุลเงิน',bill.currency)}${detailCell('เจ้าของบิล',bill.source_user_name||bill.source_user_id)}${detailCell('ช่องทาง',bill.source)}
      </div></section>
      <section class="rounded-2xl bg-slate-50 p-4"><h4 class="mb-3 font-semibold text-slate-700">รายการสินค้า/บริการ</h4>${items?`<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr><th>#</th><th>รายการ</th><th>จำนวน</th><th>ราคาต่อหน่วย</th><th>รวม</th></tr></thead><tbody>${items}</tbody></table></div>`:'<p class="text-slate-400">ไม่มีรายการย่อย</p>'}</section>
      <section class="rounded-2xl bg-slate-50 p-4"><h4 class="mb-3 font-semibold text-slate-700">รูปและเอกสารต้นฉบับ</h4><div class="flex flex-wrap gap-2">${documents||'<span class="text-slate-400">ไม่พบไฟล์เอกสาร</span>'}</div></section>
      <details class="bill-system-details"><summary>ข้อมูลระบบและประวัติ</summary><div class="mt-4 grid gap-3 sm:grid-cols-2">${detailCell('สร้างเมื่อ',thaiDate(String(bill.created_at||'').slice(0,10)))}${detailCell('แก้ไขล่าสุด',thaiDate(String(bill.updated_at||'').slice(0,10)))}${detailCell('ยืนยันเมื่อ',thaiDate(String(bill.confirmed_at||'').slice(0,10)))}${detailCell('Bill ID',bill.bill_id,true)}${detailCell('Session ID',bill.session_id,true)}${detailCell('Vendor ID',bill.vendor_id,true)}${detailCell('รหัสตรวจบิลซ้ำ',bill.duplicate_key,true)}${detailCell('ที่เก็บไฟล์',bill.folder_path,true)}</div></details>
      ${bill.status === 'REJECTED' ? `<section class="rounded-2xl border border-amber-200 bg-amber-50 p-4"><button class="w-full rounded-xl bg-amber-700 px-4 py-3 font-medium text-white" data-restore-bill="${escapeHtml(bill.bill_id)}">กู้คืนบิลนี้</button><p class="mt-2 text-center text-xs text-amber-700">กู้คืนแล้วจะกลับไปสถานะต้องตรวจสอบ</p></section>` : `<section class="rounded-2xl border border-red-200 bg-red-50 p-4"><button class="w-full rounded-xl bg-red-600 px-4 py-3 font-medium text-white" data-delete-bill="${escapeHtml(bill.bill_id)}">ลบบิลออกจากรายการ</button><p class="mt-2 text-center text-xs text-red-600">ไม่รวมใน Dashboard/Export แต่ยังเก็บประวัติและรูปไว้ให้กู้คืนได้</p></section>`}
    </div>`;
  }

  function detailCell(label, value, wide) { return `<div class="${wide?'sm:col-span-2':''}"><span class="text-xs text-slate-400">${escapeHtml(label)}</span><p class="mt-1 break-words font-medium">${escapeHtml(value == null || value === '' ? '-' : value)}</p></div>`; }
  function docTypeLabel(value) { return ({TAX_INVOICE:'ใบกำกับภาษี',RECEIPT:'ใบเสร็จรับเงิน',CASH_BILL:'บิลเงินสด',INVOICE:'ใบแจ้งหนี้',DELIVERY_NOTE:'ใบส่งของ',TOLL:'ค่าผ่านทาง/ทางด่วน',TRANSFER_SLIP:'สลิปโอนเงิน',OTHER:'เอกสารอื่นๆ'})[value] || value || '-'; }

  async function previewDocument(docId) {
    try {
      const document = await runBusy(() => gas('getBillDocumentPreview', docId), 'กำลังโหลดเอกสาร…');
      if (document.dataUrl && /^image\//.test(document.mimeType)) {
        await Swal.fire({ title:document.fileName, imageUrl:document.dataUrl, imageAlt:document.fileName, width:900, confirmButtonText:'ปิด' });
      } else if (document.dataUrl && document.mimeType === 'application/pdf') {
        await Swal.fire({ title:document.fileName, html:`<iframe class="h-[70vh] w-full" src="${document.dataUrl}"></iframe>`, width:1000, confirmButtonText:'ปิด' });
      } else if (document.externalUrl) {
        window.open(document.externalUrl, '_blank', 'noopener');
      } else throw new Error('ไฟล์นี้ไม่มีตัวอย่างให้แสดง');
    } catch (error) { Swal.fire('เปิดเอกสารไม่ได้',error.message,'error'); }
  }

  async function deleteBillFromWeb(billId) {
    const confirm = await Swal.fire({ icon:'warning', title:'ลบบิลออกจากรายการ?', text:'บิลจะหายจาก Dashboard และ Export แต่ยังกู้คืนได้จากตัวกรอง “ลบ/ยกเลิกแล้ว”', showCancelButton:true, confirmButtonText:'ลบบิล', cancelButtonText:'กลับ', confirmButtonColor:'#dc2626' });
    if (!confirm.isConfirmed) return;
    await runBusy(() => gas('deleteBill', billId, 'WEB'), 'กำลังลบบิลออกจากรายการ…');
    await bootstrap();
    if (!document.getElementById('view-bills').classList.contains('hidden')) await loadAllBills(1);
    Swal.fire({ icon:'success', title:'ลบบิลแล้ว', text:'ยังกู้คืนได้จากตัวกรองรายการที่ลบ', timer:1800, showConfirmButton:false });
  }

  async function restoreBillFromWeb(billId) {
    const confirm = await Swal.fire({ icon:'question', title:'กู้คืนบิลนี้?', text:'ระบบจะเปิดให้ตรวจสอบข้อมูลก่อนยืนยันอีกครั้ง', showCancelButton:true, confirmButtonText:'กู้คืน', cancelButtonText:'กลับ', confirmButtonColor:'#8f5f42' });
    if (!confirm.isConfirmed) return;
    await runBusy(() => gas('restoreBill', billId, 'WEB'), 'กำลังกู้คืนบิล…');
    await bootstrap();
    if (!document.getElementById('view-bills').classList.contains('hidden')) await loadAllBills(1);
    Swal.fire({ icon:'success', title:'กู้คืนแล้ว', text:'บิลกลับไปอยู่ในคิวต้องตรวจสอบ', timer:1800, showConfirmButton:false });
  }

  const monthlyExportSpecs = {
    word: {
      create:selection => gas('exportMonthlyBillWord', selection), buttonId:'export-monthly-btn', label:'DOCX',
      buttonLabel:'Export DOCX', loadingLabel:'กำลังสร้าง DOCX…',
      busyTitle:'กำลังจัดรูปบิลลง DOCX…', fileDescription:'รูปบิลที่จัดหน้าและบีบอัดแล้ว',
    },
    excel: {
      create:selection => gas('exportMonthlyBillExcel', selection), buttonId:'export-excel-btn', label:'Excel',
      buttonLabel:'Export Excel', loadingLabel:'กำลังสร้าง Excel…',
      busyTitle:'กำลังสร้างตาราง Excel…', fileDescription:'ตารางสรุปรายการบิล',
    },
  };
  const activeMonthlyExports = new Set();

  function selectedLabel(id) {
    const element=document.getElementById(id),option=element&&element.options[element.selectedIndex];
    return option ? option.textContent.trim() : '';
  }

  function exportSelection() {
    const filters={...currentBillFilters(),query:document.getElementById('bill-search').value.trim()};
    const conditions=[];
    if(filters.query)conditions.push(`ค้นหา: ${filters.query}`);
    if(filters.status)conditions.push(`สถานะ: ${selectedLabel('bill-status')}`);
    if(filters.project_id)conditions.push(`โครงการ: ${selectedLabel('bill-project-filter')}`);
    if(filters.company_id)conditions.push(`บริษัท: ${selectedLabel('bill-company-filter')}`);
    if(filters.category_id)conditions.push(`หมวด: ${selectedLabel('bill-category-filter')}`);
    if(filters.date_from)conditions.push(`ตั้งแต่วันที่: ${thaiDate(filters.date_from)}`);
    if(filters.date_to)conditions.push(`ถึงวันที่: ${thaiDate(filters.date_to)}`);
    if(!conditions.length){const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;return{selection:{month},conditions:[`เดือนปัจจุบัน: ${thaiMonthPeriod(month)}`]};}
    return{selection:filters,conditions};
  }

  async function exportMonthlyFile(kind) {
    const spec = monthlyExportSpecs[kind];
    if (!spec || activeMonthlyExports.has(kind)) return;
    const exportPlan=exportSelection();
    let preview;
    try{preview=await gas('listBills',{...exportPlan.selection,page:1,page_size:10});}catch(error){return Swal.fire('ตรวจสอบรายการ Export ไม่สำเร็จ',error.message,'error');}
    const confirmation=await Swal.fire({icon:'question',title:`ยืนยัน Export ${spec.label}`,html:`<div class="export-confirmation"><p>ระบบจะส่งออกตามเงื่อนไขต่อไปนี้</p><ul>${exportPlan.conditions.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul><strong>${Number(preview.total||0).toLocaleString('th-TH')} บิล</strong></div>`,showCancelButton:true,confirmButtonText:`สร้าง ${spec.label}`,cancelButtonText:'กลับไปตรวจตัวกรอง',confirmButtonColor:'#8f5f42'});
    if(!confirmation.isConfirmed)return;
    const button = document.getElementById(spec.buttonId);
    const label = button.querySelector('[data-export-label]');
    activeMonthlyExports.add(kind);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (label) label.textContent = spec.loadingLabel;
    showActivityToast(spec.busyTitle, 'กำลังเตรียมเฉพาะไฟล์ที่เลือก คุณยังเปิดดูส่วนอื่นได้');
    try {
      const file = await spec.create(exportPlan.selection);
      let downloadInProgress = false;
      showActivityToast(`${spec.label} พร้อมดาวน์โหลด`, `${Number(file.count || 0).toLocaleString('th-TH')} บิล · ${formatFileSize(file.sizeBytes)}`, 'success');
      await Swal.fire({
        icon:'success',
        title:`${spec.label} พร้อมดาวน์โหลด`,
        html:`<p class="mb-2 text-sm text-slate-500">พบ ${Number(file.count || 0).toLocaleString('th-TH')} บิลตามเงื่อนไขที่ยืนยัน</p><p class="mb-4 text-xs text-slate-400">ดาวน์โหลดจาก NAS ผ่านหน้าแอปได้โดยตรง และรองรับไฟล์ขนาดใหญ่กว่า 45 MB</p><div class="export-download-grid export-download-grid--single"><a href="#" role="button" data-export-download="${kind}">ดาวน์โหลด ${spec.label}<small data-export-progress="${kind}">${spec.fileDescription} · ${formatFileSize(file.sizeBytes)}</small></a></div>`,
        confirmButtonText:'ปิด',
        confirmButtonColor:'#8f5f42',
        width:520,
        didOpen:popup => {
          const link = popup.querySelector('[data-export-download]');
          if (!link) return;
          link.addEventListener('click', async event => {
            event.preventDefault();
            if (downloadInProgress) return Swal.showValidationMessage('กรุณารอให้ดาวน์โหลดไฟล์ปัจจุบันเสร็จก่อน');
            downloadInProgress = true;
            Swal.resetValidationMessage();
            try {
              await downloadExportFile(file, percent => {
                const progress = popup.querySelector(`[data-export-progress="${kind}"]`);
                if (progress) progress.textContent = `กำลังเตรียมไฟล์ ${percent}%`;
              });
              const progress = popup.querySelector(`[data-export-progress="${kind}"]`);
              if (progress) progress.textContent = 'ดาวน์โหลดสำเร็จ';
            } catch (error) {
              Swal.showValidationMessage(error.message);
              const progress = popup.querySelector(`[data-export-progress="${kind}"]`);
              if (progress) progress.textContent = `ลองใหม่ · ${formatFileSize(file.sizeBytes)}`;
            } finally { downloadInProgress = false; }
          });
        },
      });
    } catch (error) {
      hideActivityToast();
      Swal.fire(`Export ${spec.label} ไม่สำเร็จ`,error.message,'error');
    } finally {
      activeMonthlyExports.delete(kind);
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (label) label.textContent = spec.buttonLabel;
    }
  }

  async function openDatabase() {
    if (!await window.ProtectedAccess.ensure()) return;
    showActivityToast('กำลังตรวจฐานข้อมูล…', 'กำลังตรวจสอบ MariaDB บน NAS');
    try {
      const access = await gas('verifyDatabaseAccess');
      const url = escapeHtml(access.url);
      hideActivityToast();
      await Swal.fire({
        icon: access.url && access.url !== '#' ? 'success' : 'info',
        title: access.url && access.url !== '#' ? 'ฐานข้อมูลพร้อมเปิด' : 'MariaDB ทำงานอยู่',
        html: access.url && access.url !== '#' ? `<p class="mb-4 text-sm text-slate-500">กดปุ่มด้านล่างเพื่อเปิด phpMyAdmin ในแท็บใหม่</p><a class="primary-btn inline-flex items-center justify-center no-underline" href="${url}" target="_blank" rel="noopener noreferrer">เปิด phpMyAdmin</a>` : `<p class="text-sm text-slate-500">${escapeHtml(access.message || 'ปิดการเปิดฐานข้อมูลจากหน้าแอปเพื่อความปลอดภัย')}</p>`,
        showConfirmButton:false,
        showCloseButton:true,
      });
    } catch (error) {
      hideActivityToast();
      throw error;
    }
  }

  function createExportFileUrl(result) {
    if (result && result.downloadUrl) return { url:result.downloadUrl, fileName:result.fileName, objectUrl:false };
    if (!result || !result.base64) throw new Error('ระบบไม่ส่งไฟล์หรือลิงก์ดาวน์โหลดกลับมา');
    const bytes = Uint8Array.from(atob(result.base64), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type:result.mimeType }));
    return { url, fileName:result.fileName, objectUrl:true };
  }

  function decodeBase64Bytes(base64) {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function downloadExportFile(result, onProgress) {
    if (!result) throw new Error('ไม่พบข้อมูลไฟล์ Export');
    if (!result.downloadToken) {
      const legacyFile = createExportFileUrl(result);
      const legacyLink = document.createElement('a');
      legacyLink.href = legacyFile.url;
      legacyLink.download = legacyFile.fileName || result.fileName;
      document.body.appendChild(legacyLink);
      legacyLink.click();
      legacyLink.remove();
      if (legacyFile.objectUrl) setTimeout(() => URL.revokeObjectURL(legacyFile.url), 30000);
      if (onProgress) onProgress(100);
      return;
    }

    const chunks = [];
    const totalBytes = Number(result.sizeBytes) || 0;
    let offset = 0;
    while (offset < totalBytes) {
      const chunk = await gas('getExportFileChunk', result.downloadToken, offset);
      if (!chunk || Number(chunk.offset) !== offset || Number(chunk.nextOffset) <= offset || !chunk.base64) {
        throw new Error('ได้รับข้อมูลไฟล์ไม่ครบ กรุณาลองดาวน์โหลดใหม่');
      }
      chunks.push(decodeBase64Bytes(chunk.base64));
      offset = Number(chunk.nextOffset);
      if (onProgress) onProgress(Math.min(100, Math.round((offset / totalBytes) * 100)));
    }
    const objectUrl = URL.createObjectURL(new Blob(chunks, { type:result.mimeType || 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = result.fileName || 'export-file';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }

  function formatFileSize(bytes) {
    const size = Number(bytes) || 0;
    if (!size) return 'บันทึกใน Drive';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toLocaleString('th-TH', { maximumFractionDigits:1 })} MB`;
    return `${Math.max(1, Math.round(size / 1024)).toLocaleString('th-TH')} KB`;
  }

  function optionHtml(rows, valueKey, labelKey, selected) { return rows.map(row => `<option value="${escapeHtml(row[valueKey])}" ${String(row[valueKey]) === String(selected) ? 'selected' : ''}>${escapeHtml(row[labelKey])}</option>`).join(''); }

  async function editBill(bill, options = {}) {
    const html = `<div class="grid gap-3 text-left sm:grid-cols-2">
      <label class="text-sm">โครงการ<select id="eb-project_id" class="swal2-select !m-0 !w-full">${optionHtml(state.masters.projects,'project_id','project_name',bill.project_id)}</select></label>
      <label class="text-sm">บริษัท<select id="eb-company_id" class="swal2-select !m-0 !w-full">${optionHtml(state.masters.companies,'company_id','company_name',bill.company_id)}</select></label>
      <label class="text-sm">หมวด<select id="eb-category_id" class="swal2-select !m-0 !w-full"><option value="">ไม่ระบุ</option>${optionHtml(state.masters.categories,'category_id','category_name',bill.category_id)}</select></label>
      <label class="text-sm">ประเภทเอกสาร<select id="eb-doc_type" class="swal2-select !m-0 !w-full">${['TAX_INVOICE','RECEIPT','CASH_BILL','INVOICE','DELIVERY_NOTE','TOLL','TRANSFER_SLIP','OTHER'].map(v=>`<option ${v===bill.doc_type?'selected':''}>${v}</option>`).join('')}</select></label>
      ${editInput('document_no','เลขที่เอกสาร',bill.document_no)}${editInput('document_date','วันที่เอกสาร',bill.document_date,'date')}
      ${editInput('vendor_name','ชื่อร้านค้า',bill.vendor_name,'text','vendor-suggestions')}${taxIdEditInput('vendor_tax_id','Tax ID ร้านค้า',bill.vendor_tax_id)}
      ${editInput('buyer_name','ชื่อผู้ซื้อ',bill.buyer_name)}${taxIdEditInput('buyer_tax_id','Tax ID ผู้ซื้อ',bill.buyer_tax_id)}
      ${editInput('subtotal','ยอดก่อนภาษี',bill.subtotal,'number')}${editInput('vat_amount','VAT',bill.vat_amount,'number')}
      ${editInput('grand_total','ยอดรวม',bill.grand_total,'number')}<label class="text-sm">หมายเหตุ<textarea id="eb-notes" class="swal2-textarea !m-0 !w-full">${escapeHtml(bill.notes||'')}</textarea></label>
    </div>`;
    const result = await Swal.fire({ title:'แก้ไขข้อมูลบิล', html, width:800, showCancelButton:true, confirmButtonText:'บันทึก', cancelButtonText:'ยกเลิก', confirmButtonColor:'#8f5f42', preConfirm:() => {
      const payload = { bill_id:bill.bill_id };
      document.querySelectorAll('[id^="eb-"]').forEach(el => payload[el.id.slice(3)] = el.value);
      for (const key of ['vendor_tax_id','buyer_tax_id']) {
        payload[key] = String(payload[key] || '').replace(/\D/g, '');
        if (payload[key] && !/^\d{13}$/.test(payload[key])) return Swal.showValidationMessage((key === 'vendor_tax_id' ? 'Tax ID ร้านค้า' : 'Tax ID ผู้ซื้อ') + ' ต้องมี 13 หลัก');
      }
      return payload;
    }});
    if (!result.isConfirmed) return { action:'closed', billId:bill.bill_id };
    const updated = await runBusy(() => gas('updateBill', result.value), 'กำลังบันทึก…');
    await bootstrap();
    return showBillResult(updated, options);
  }

  function editInput(id,label,value,type='text',list='') { return `<label class="text-sm">${label}<input id="eb-${id}" type="${type}" ${list?`list="${list}"`:''} step="0.01" class="swal2-input !m-0 !w-full" value="${escapeHtml(value == null ? '' : value)}"></label>`; }
  function taxIdEditInput(id,label,value) { return `<label class="text-sm">${label}<input id="eb-${id}" type="text" inputmode="numeric" maxlength="13" pattern="[0-9]{13}" autocomplete="off" class="swal2-input !m-0 !w-full" value="${escapeHtml(value == null ? '' : value)}" placeholder="0XXXXXXXXXXXX"><small class="mt-1 block text-xs text-slate-400">13 หลัก · เลข 0 ด้านหน้าจะไม่ถูกตัด</small></label>`; }

  async function openBill(billId, silent = false) {
    try {
      const bill = await gas('getBillDetail', billId);
      await showBillResult(bill);
      return true;
    } catch (error) {
      if (!silent) Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
      return false;
    }
  }

  async function openBillForEdit(billId) {
    showActivityToast('กำลังเปิดฟอร์มแก้ไข…', 'โหลดข้อมูลและรูปบิลรายการที่เลือก');
    try {
      const bill=await gas('getBillDetail',billId);
      hideActivityToast();
      switchView('bills');
      await editBill(bill);
      if(history.replaceState)history.replaceState({},document.title,location.pathname);
      return true;
    } catch(error) {
      hideActivityToast();
      await Swal.fire({icon:'error',title:'เปิดบิลเพื่อแก้ไขไม่ได้',text:error.message});
      return false;
    }
  }

  async function startPendingReviewWorkflow(initialBillId) {
    if (state.reviewWorkflowActive) return;
    state.reviewWorkflowActive = true;
    try {
      let currentBillId = initialBillId || '';
      let pending = [];
      let mayFallbackToQueue = !!currentBillId;
      if (!currentBillId) {
        pending = await getPendingReviewQueue();
        if (!pending.length) return;
        currentBillId = pending[0].bill_id;
      }
      while (currentBillId) {
        let bill;
        showActivityToast('กำลังเปิดบิลล่าสุด…', 'ดึงรายละเอียดเพื่อให้ตรวจสอบ');
        try {
          bill = await gas('getBillDetail', currentBillId);
          hideActivityToast();
        } catch (error) {
          hideActivityToast();
          if (mayFallbackToQueue) {
            mayFallbackToQueue = false;
            pending = await getPendingReviewQueue();
            if (history.replaceState) history.replaceState({}, document.title, location.pathname);
            if (pending.length) {
              currentBillId = pending[0].bill_id;
              continue;
            }
          }
          return;
        }
        if (['NEEDS_REVIEW','PENDING_CONFIRMATION'].indexOf(bill.status) < 0) {
          if (initialBillId) await showBillResult(bill);
          return;
        }
        if (!pending.length) pending = await getPendingReviewQueue();
        const outcome = await showBillResult(bill, { queueMode:true, remainingCount:Math.max(1, pending.length) });
        if (!outcome || outcome.action !== 'confirmed') return;
        const remaining = await getPendingReviewQueue();
        if (!remaining.length) {
          showActivityToast('ตรวจสอบครบแล้ว', 'ไม่มีบิลสถานะตรวจสอบค้างอยู่', 'success');
          return;
        }
        showActivityToast('ยืนยันแล้ว · กำลังเปิดรายการถัดไป', `เหลืออีก ${remaining.length.toLocaleString('th-TH')} รายการ`, 'success');
        currentBillId = remaining[0].bill_id;
        pending = remaining;
      }
    } finally { state.reviewWorkflowActive = false; }
  }

  async function getPendingReviewQueue() {
    const bootstrapRows = Array.isArray(state.pendingReviews) ? state.pendingReviews.slice() : [];
    bootstrapRows.sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
    if (bootstrapRows.length) return bootstrapRows;
    const localRows = ((state.dashboard && state.dashboard.bills) || [])
      .filter(bill => ['NEEDS_REVIEW','PENDING_CONFIRMATION'].includes(bill.status))
      .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
    if (localRows.length || !state.dashboard || Number(state.dashboard.totals.review || 0) === 0) return localRows;
    const result = await gas('listPendingReviewBills');
    return Array.isArray(result) ? result : [];
  }
  let activityToastTimer = null;
  function showActivityToast(title, detail, type = 'loading') {
    const toast = document.getElementById('activity-toast');
    clearTimeout(activityToastTimer);
    toast.classList.remove('hidden','is-success');
    toast.classList.toggle('is-success', type === 'success');
    document.getElementById('activity-toast-title').textContent = title;
    document.getElementById('activity-toast-detail').textContent = detail || '';
    document.getElementById('activity-toast-icon').className = type === 'success' ? 'activity-toast__check' : 'activity-toast__spinner';
    if (type === 'success') activityToastTimer = setTimeout(hideActivityToast, 2200);
  }
  function hideActivityToast() {
    clearTimeout(activityToastTimer);
    document.getElementById('activity-toast').classList.add('hidden');
  }
  async function runBusy(fn, title) { Swal.fire({ title, allowOutsideClick:false, didOpen:()=>Swal.showLoading() }); try { return await fn(); } finally { Swal.close(); } }

  async function loadSystemStatus() {
    try { const s = await gas('getSystemStatus'); const diagnostics = s.lineDiagnostics || {}; const gemini = s.geminiDiagnostics || {}; document.getElementById('system-status').innerHTML = [
      ['ฐานข้อมูล',s.spreadsheet,true],['พื้นที่จัดเก็บ NAS',s.folder,true],['Gemini API Key',gemini.message || (s.geminiConfigured?'ตั้งค่าแล้ว':'ยังไม่ได้ตั้งค่า'),!!gemini.valid],['LINE Messaging API',s.lineConfigured?'ตั้งค่าแล้ว':'ยังตั้งค่าไม่ครบ',!!s.lineConfigured],['AI Model',s.model,true]
    ].map(item=>`<div class="flex items-center justify-between rounded-xl bg-slate-50 p-4"><div><p class="text-xs text-slate-400">${item[0]}</p><p class="text-sm font-medium">${escapeHtml(item[1])}</p></div><span class="h-3 w-3 rounded-full ${item[2]?'bg-emerald-500':'bg-amber-400'}"></span></div>`).join('') +
    `<div class="rounded-xl bg-slate-50 p-4"><p class="text-xs text-slate-400">Webhook URL</p><p class="mt-1 break-all text-xs">${escapeHtml((diagnostics.webhook||{}).endpoint || '-')}</p></div>` +
    `<div class="rounded-xl bg-slate-50 p-4"><p class="text-xs text-slate-400">LIFF URL</p><p class="mt-1 break-all text-xs">${escapeHtml(diagnostics.liff_url || '-')}</p></div>` +
    `<div class="rounded-xl bg-slate-50 p-4"><p class="text-xs text-slate-400">ลิงก์สำรอง Android/Samsung (เปิด Chrome)</p><p class="mt-1 break-all text-xs">${escapeHtml(diagnostics.android_external_url || '-')}</p></div>` +
    ((diagnostics.rich_menus||[]).map(menu=>`<div class="rounded-xl bg-slate-50 p-4"><p class="text-xs text-slate-400">Rich Menu: ${escapeHtml(menu.name)}</p>${(menu.uri_actions||[]).map(uri=>`<p class="mt-1 break-all text-xs">${escapeHtml(uri)}</p>`).join('')||'<p class="mt-1 text-xs text-amber-600">ไม่พบ URI action</p>'}</div>`).join('')) +
    ((diagnostics.warnings||[]).length ? `<div class="rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><p class="font-semibold">สิ่งที่ต้องแก้</p><ul class="mt-2 list-disc pl-5">${diagnostics.warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : '<div class="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">ไม่พบข้อผิดพลาดในการตั้งค่า LINE/LIFF</div>') +
    '<button id="backfill-users" class="primary-btn w-full">อัปเดตชื่อผู้ส่งจาก LINE</button>'; } catch(error) { document.getElementById('system-status').textContent = error.message; }
  }

  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view]');
    if (nav) {
      const view = nav.dataset.view;
      if (protectedViews.includes(view) && !await window.ProtectedAccess.ensure()) return;
      switchView(view);
    }
    const add = event.target.closest('[data-add]'); if (add) await openMasterForm(add.dataset.add);
    const edit = event.target.closest('[data-edit]'); if (edit) { const map={project:['projects','project_id'],company:['companies','company_id'],category:['categories','category_id']}; const [list,key]=map[edit.dataset.edit]; await openMasterForm(edit.dataset.edit,state.masters[list].find(x=>String(x[key])===String(edit.dataset.id))||{}); }
    const del = event.target.closest('[data-delete]'); if (del) await deleteMaster(del.dataset.delete,del.dataset.id);
    const bill = event.target.closest('[data-bill]'); if (bill) await openBill(bill.dataset.bill);
    const preview = event.target.closest('[data-preview-doc]'); if (preview) await previewDocument(preview.dataset.previewDoc);
    const deleteBillButton = event.target.closest('[data-delete-bill]'); if (deleteBillButton) await deleteBillFromWeb(deleteBillButton.dataset.deleteBill);
    const restoreBillButton = event.target.closest('[data-restore-bill]'); if (restoreBillButton) await restoreBillFromWeb(restoreBillButton.dataset.restoreBill);
    const backfill = event.target.closest('#backfill-users'); if (backfill) { const result = await runBusy(() => gas('backfillLineUsernames'), 'กำลังอ่านชื่อจาก LINE…'); Swal.fire({icon:'success',title:'เรียบร้อย',text:result.message}); }
  });
  document.getElementById('bill-files').addEventListener('change', previewFiles);
  ['upload-project','upload-company','expected-pages'].forEach(id => document.getElementById(id).addEventListener('change', () => { state.uploadRequestId = ''; }));
  document.getElementById('upload-form').addEventListener('submit', submitUpload);
  document.querySelectorAll('[data-quick-settings-form]').forEach(form => form.addEventListener('submit', saveQuickSettingsFromWeb));
  document.querySelectorAll('[data-clear-quick-slot]').forEach(button => button.addEventListener('click', clearQuickSettingsFromWeb));
  document.getElementById('upload-quick-options').addEventListener('click', event => {
    const button = event.target.closest('[data-apply-upload-quick]');
    if (button) applyQuickSettingsToUpload(Number(button.dataset.applyUploadQuick), true);
  });
  document.getElementById('search-bills-btn').addEventListener('click', () => loadAllBills(1));
  document.getElementById('bill-search').addEventListener('keydown', event => { if (event.key === 'Enter') loadAllBills(1); });
  ['bill-status','bill-project-filter','bill-company-filter','bill-category-filter','bill-date-from','bill-date-to','bill-sort'].forEach(id => document.getElementById(id).addEventListener('change', () => loadAllBills(1)));
  document.getElementById('export-monthly-btn').addEventListener('click', () => exportMonthlyFile('word'));
  document.getElementById('export-excel-btn').addEventListener('click', () => exportMonthlyFile('excel'));
  document.getElementById('open-database-btn').addEventListener('click', () => openDatabase().catch(showFatal));
  document.getElementById('open-review-queue').addEventListener('click', () => startPendingReviewWorkflow('').catch(showFatal));
  document.getElementById('dashboard-prev-month').addEventListener('click', () => refreshDashboard({ period:shiftDashboardPeriod(state.dashboardFilters.period, -1), owners:null }));
  document.getElementById('dashboard-next-month').addEventListener('click', () => refreshDashboard({ period:shiftDashboardPeriod(state.dashboardFilters.period, 1), owners:null }));
  document.getElementById('dashboard-month').addEventListener('change', event => refreshDashboard({ period:event.target.value, owners:null }));
  document.querySelectorAll('[data-dashboard-mode]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.dashboardMode;
    if (mode === state.dashboardFilters.view_mode) return;
    refreshDashboard({ view_mode:mode, owners:mode === 'person' ? null : state.dashboardFilters.owners });
  }));
  document.getElementById('dashboard-owner-options').addEventListener('change', event => {
    if (event.target.matches('[data-dashboard-owner]')) scheduleDashboardOwnerRefresh();
  });
  document.getElementById('dashboard-owner-select-all').addEventListener('click', () => {
    const owners = ((state.dashboard && state.dashboard.ownerOptions) || []).map(owner => owner.label);
    refreshDashboard({ owners:owners });
  });
  document.getElementById('dashboard-owner-clear').addEventListener('click', () => refreshDashboard({ owners:[] }));
  document.getElementById('bill-prev').addEventListener('click', () => loadAllBills(Math.max(1, state.billList.page - 1)));
  document.getElementById('bill-next').addEventListener('click', () => loadAllBills(Math.min(state.billList.pages, state.billList.page + 1)));
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    try {
      await bootstrap();
      if (!document.getElementById('view-bills').classList.contains('hidden')) await loadAllBills(state.billList.page || 1);
      if (!document.getElementById('view-receipts').classList.contains('hidden') && window.ReceiptModule) await window.ReceiptModule.activate(true);
    } catch (error) { showFatal(error); }
  });
  function showFatal(error) { document.getElementById('loading-screen').classList.add('hidden'); Swal.fire({ icon:'error', title:'ระบบไม่พร้อม', text:error.message }); }
  async function initializeLiff() {
    if (window.OPEN_EXTERNAL_BROWSER) return;
    if (!window.LIFF_ID || !window.liff) return;
    try {
      await liff.init({ liffId: window.LIFF_ID, withLoginOnExternalBrowser: true });
      const restoredBillId = new URLSearchParams(location.search).get('bill_id');
      if (restoredBillId) window.INITIAL_BILL_ID = restoredBillId;
    }
    catch (error) { console.warn('LIFF init failed:', error.message); }
  }
  async function startApp() {
    try {
      const health = await window.V2Api.connect();
      window.LIFF_ID = health.liffId || '';
      document.title = health.appName || 'WorkHub';
      await initializeLiff();
      await bootstrap();
      const linkedBillId = window.INITIAL_BILL_ID || '';
      window.setTimeout(() => {
        if(linkedBillId&&window.INITIAL_BILL_EDIT)openBillForEdit(linkedBillId).catch(showFatal);
        else startPendingReviewWorkflow(linkedBillId).catch(showFatal);
      }, 450);
    } catch (error) { showFatal(error); }
  }
  startApp();
