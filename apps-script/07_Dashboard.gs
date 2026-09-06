function getDashboard(filters) {
  try {
    setupIfNeeded_();
    filters = filters || {};
    const allBills = publicRows_(SHEETS.BILLS).filter(function (bill) {
      return cleanString_(bill.status).toUpperCase() !== 'REJECTED';
    });
    const projects = publicRows_(SHEETS.PROJECTS);
    const categories = publicRows_(SHEETS.CATEGORIES);
    const projectNames = indexBy_(projects, 'project_id', 'project_name');
    const categoryNames = indexBy_(categories, 'category_id', 'category_name');
    const currentPeriod = Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy-MM');
    const selectedPeriod = normalizeDashboardPeriod_(filters.period, currentPeriod);
    const viewMode = cleanString_(filters.view_mode).toLowerCase() === 'person' ? 'person' : 'overall';
    const periodBills = allBills.filter(function (bill) { return dashboardBillPeriod_(bill) === selectedPeriod; });
    const ownerOptions = aggregateUploaderSummary_(periodBills);
    const availableOwners = ownerOptions.map(function (owner) { return owner.label; });
    const ownersProvided = Array.isArray(filters.owners);
    const selectedOwners = viewMode === 'person'
      ? sanitizeDashboardOwners_(ownersProvided ? filters.owners : availableOwners, availableOwners)
      : [];
    const selectedOwnerMap = selectedOwners.reduce(function (map, owner) { map[owner] = true; return map; }, {});
    const bills = viewMode === 'person'
      ? allBills.filter(function (bill) { return !!selectedOwnerMap[billOwnerLabel_(bill)]; })
      : allBills;
    const selectedPeriodBills = bills.filter(function (bill) { return dashboardBillPeriod_(bill) === selectedPeriod; });
    const summary = buildDashboardSummary_(bills, projects, selectedPeriod);
    const totals = bills.reduce(function (acc, bill) {
      acc.total += toNumber_(bill.grand_total);
      acc.vat += toNumber_(bill.vat_amount);
      acc.count += 1;
      if (['NEEDS_REVIEW', 'PENDING_CONFIRMATION'].indexOf(bill.status) >= 0) acc.review += 1;
      return acc;
    }, { total: 0, vat: 0, count: 0, review: 0 });
    const byMonth = aggregate_(bills, function (bill) { return dashboardBillPeriod_(bill); });
    const byProject = aggregate_(selectedPeriodBills, function (bill) { return projectNames[bill.project_id] || 'ไม่ระบุโครงการ'; });
    const byCategory = aggregate_(selectedPeriodBills, function (bill) { return categoryNames[bill.category_id] || 'ยังไม่จัดกลุ่ม'; });
    const uploaderSummary = aggregateUploaderSummary_(selectedPeriodBills);
    const personBreakdowns = buildOwnerCategoryBreakdowns_(selectedPeriodBills, categoryNames);
    const recent = selectedPeriodBills.slice().sort(compareBillsByDocumentDateDesc_).slice(0, 50);
    recent.forEach(function (bill) {
      bill.project_name = projectNames[bill.project_id] || '-';
      bill.category_name = categoryNames[bill.category_id] || '-';
    });
    return ok_({
      filters: {
        period: selectedPeriod,
        currentPeriod: currentPeriod,
        viewMode: viewMode,
        selectedOwners: selectedOwners,
        ownersProvided: ownersProvided,
      },
      ownerOptions: ownerOptions,
      summary: summary,
      totals: totals,
      byMonth: byMonth,
      byProject: byProject,
      byCategory: byCategory,
      uploaderSummary: uploaderSummary,
      personBreakdowns: personBreakdowns,
      bills: recent,
    });
  } catch (error) { return fail_(error); }
}

function normalizeDashboardPeriod_(value, maximumPeriod) {
  const maximum = /^\d{4}-\d{2}$/.test(cleanString_(maximumPeriod)) ? cleanString_(maximumPeriod) : Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy-MM');
  const candidate = cleanString_(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate)) return maximum;
  return candidate > maximum ? maximum : candidate;
}

function dashboardBillPeriod_(bill) {
  return cleanString_(bill && (bill.document_date || bill.created_at)).slice(0, 7);
}

function billOwnerLabel_(bill) {
  let owner = cleanString_(bill && bill.source_user_id, 120);
  if (!owner || /^U[0-9a-f]{20,64}$/i.test(owner)) {
    owner = cleanString_(bill && bill.source).toUpperCase() === 'LINE' ? 'ผู้ส่งผ่าน LINE' : 'เว็บแอป';
  }
  return owner;
}

function sanitizeDashboardOwners_(requestedOwners, availableOwners) {
  const availableMap = (availableOwners || []).reduce(function (map, owner) { map[cleanString_(owner, 120)] = true; return map; }, {});
  const seen = {};
  return (requestedOwners || []).map(function (owner) { return cleanString_(owner, 120); }).filter(function (owner) {
    if (!owner || !availableMap[owner] || seen[owner]) return false;
    seen[owner] = true;
    return true;
  });
}

function compareBillsByDocumentDateDesc_(left, right) {
  const dateCompare = cleanString_(right.document_date).localeCompare(cleanString_(left.document_date));
  if (dateCompare) return dateCompare;
  return cleanString_(right.created_at).localeCompare(cleanString_(left.created_at));
}

function buildDashboardSummary_(bills, projects, currentPeriod) {
  const period = /^\d{4}-\d{2}$/.test(cleanString_(currentPeriod)) ? cleanString_(currentPeriod) : Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy-MM');
  const currentYear = period.slice(0, 4);
  const currentMonth = Number(period.slice(5, 7));
  const previousPeriod = currentMonth === 1
    ? String(Number(currentYear) - 1) + '-12'
    : currentYear + '-' + String(currentMonth - 1).padStart(2, '0');
  const projectNames = indexBy_(projects || [], 'project_id', 'project_name');
  const currentMonthRows = [];
  const currentYearRows = [];
  const previousMonthRows = [];
  let reviewCount = 0;

  (bills || []).forEach(function (bill) {
    const billPeriod = cleanString_(bill.document_date || bill.created_at).slice(0, 7);
    if (billPeriod === period) currentMonthRows.push(bill);
    if (billPeriod.slice(0, 4) === currentYear) currentYearRows.push(bill);
    if (billPeriod === previousPeriod) previousMonthRows.push(bill);
    if (['NEEDS_REVIEW', 'PENDING_CONFIRMATION'].indexOf(cleanString_(bill.status).toUpperCase()) >= 0) reviewCount += 1;
  });

  const previousProjectMap = {};
  previousMonthRows.forEach(function (bill) {
    const projectId = cleanString_(bill.project_id);
    const projectName = projectNames[projectId];
    if (!projectId || !projectName) return;
    if (!previousProjectMap[projectId]) previousProjectMap[projectId] = { project_id: projectId, project_name: projectName, total: 0 };
    previousProjectMap[projectId].total += toNumber_(bill.grand_total);
  });

  function totalOf(rows) {
    return rows.reduce(function (total, bill) { return total + toNumber_(bill.grand_total); }, 0);
  }

  const projectBreakdown = Object.keys(previousProjectMap).map(function (projectId) {
    return previousProjectMap[projectId];
  }).sort(function (left, right) {
    return right.total - left.total || cleanString_(left.project_name).localeCompare(cleanString_(right.project_name), 'th');
  });

  return {
    currentMonth: { period: period, total: totalOf(currentMonthRows) },
    currentYear: { year: currentYear, total: totalOf(currentYearRows) },
    previousMonth: { period: previousPeriod, total: totalOf(previousMonthRows), projects: projectBreakdown },
    reviewCount: reviewCount,
  };
}

function aggregateUploaderSummary_(rows) {
  const map = {};
  (rows || []).forEach(function (bill) {
    const uploader = billOwnerLabel_(bill);
    if (!map[uploader]) map[uploader] = { label: uploader, count: 0, total: 0 };
    map[uploader].count += 1;
    map[uploader].total += toNumber_(bill.grand_total);
  });
  return Object.keys(map).map(function (key) {
    return map[key];
  }).sort(function (left, right) {
    return right.total - left.total || right.count - left.count || cleanString_(left.label).localeCompare(cleanString_(right.label), 'th');
  });
}

function buildOwnerCategoryBreakdowns_(rows, categoryNames) {
  const owners = {};
  (rows || []).forEach(function (bill) {
    const ownerLabel = billOwnerLabel_(bill);
    const categoryLabel = categoryNames[bill.category_id] || 'ยังไม่จัดกลุ่ม';
    if (!owners[ownerLabel]) owners[ownerLabel] = { label: ownerLabel, count: 0, total: 0, categories: {} };
    const owner = owners[ownerLabel];
    if (!owner.categories[categoryLabel]) owner.categories[categoryLabel] = { label: categoryLabel, count: 0, total: 0 };
    const amount = toNumber_(bill.grand_total);
    owner.count += 1;
    owner.total += amount;
    owner.categories[categoryLabel].count += 1;
    owner.categories[categoryLabel].total += amount;
  });
  return Object.keys(owners).map(function (ownerLabel) {
    const owner = owners[ownerLabel];
    owner.categories = Object.keys(owner.categories).map(function (categoryLabel) {
      return owner.categories[categoryLabel];
    }).sort(function (left, right) {
      return right.total - left.total || cleanString_(left.label).localeCompare(cleanString_(right.label), 'th');
    });
    return owner;
  }).sort(function (left, right) {
    return right.total - left.total || cleanString_(left.label).localeCompare(cleanString_(right.label), 'th');
  });
}

function aggregate_(rows, keyFn) {
  const map = {};
  rows.forEach(function (row) {
    const key = keyFn(row) || 'ไม่ระบุ';
    if (!map[key]) map[key] = { label: key, total: 0, count: 0 };
    map[key].total += toNumber_(row.grand_total);
    map[key].count += 1;
  });
  return Object.keys(map).sort().map(function (key) { return map[key]; });
}

function indexBy_(rows, idField, valueField) {
  return rows.reduce(function (acc, row) { acc[row[idField]] = row[valueField]; return acc; }, {});
}

function listBills(filters) {
  try {
    setupIfNeeded_();
    filters = filters || {};
    const query = cleanString_(filters.query).toLowerCase();
    const projectId = cleanString_(filters.project_id);
    const companyId = cleanString_(filters.company_id);
    const categoryId = cleanString_(filters.category_id);
    const status = cleanString_(filters.status);
    const dateFrom = cleanString_(filters.date_from);
    const dateTo = cleanString_(filters.date_to);
    const year = cleanString_(filters.year);
    const month = cleanString_(filters.month).padStart(2, '0');
    const projects = publicRows_(SHEETS.PROJECTS);
    const companies = publicRows_(SHEETS.COMPANIES);
    const categories = publicRows_(SHEETS.CATEGORIES);
    const projectNames = indexBy_(projects, 'project_id', 'project_name');
    const companyNames = indexBy_(companies, 'company_id', 'company_name');
    const categoryNames = indexBy_(categories, 'category_id', 'category_name');
    let rows = publicRows_(SHEETS.BILLS).filter(function (bill) {
      const date = cleanString_(bill.document_date || bill.created_at).slice(0, 10);
      if (projectId && bill.project_id !== projectId) return false;
      if (companyId && bill.company_id !== companyId) return false;
      if (categoryId && bill.category_id !== categoryId) return false;
      if (status && bill.status !== status) return false;
      if (!status && bill.status === 'REJECTED') return false;
      if (dateFrom && date < dateFrom) return false;
      if (dateTo && date > dateTo) return false;
      if (year && date.slice(0, 4) !== year) return false;
      if (filters.month && date.slice(5, 7) !== month) return false;
      if (query) {
        const haystack = [bill.document_no, bill.vendor_name, bill.vendor_tax_id, bill.buyer_name, bill.buyer_tax_id,
          bill.description, bill.notes, bill.source_user_id, projectNames[bill.project_id], companyNames[bill.company_id], categoryNames[bill.category_id]]
          .map(function (value) { return cleanString_(value).toLowerCase(); }).join(' ');
        if (haystack.indexOf(query) < 0) return false;
      }
      return true;
    });
    rows.forEach(function (bill) {
      bill.project_name = projectNames[bill.project_id] || '-';
      bill.company_name = companyNames[bill.company_id] || '-';
      bill.category_name = categoryNames[bill.category_id] || 'ยังไม่จัดกลุ่ม';
    });
    const allowedSorts = ['document_date', 'created_at', 'grand_total', 'vendor_name', 'status', 'document_no'];
    const sortBy = allowedSorts.indexOf(filters.sort_by) >= 0 ? filters.sort_by : 'document_date';
    const direction = filters.sort_dir === 'asc' ? 1 : -1;
    rows.sort(function (left, right) {
      if (sortBy === 'grand_total') return (toNumber_(left[sortBy]) - toNumber_(right[sortBy])) * direction;
      const compared = cleanString_(left[sortBy]).localeCompare(cleanString_(right[sortBy]), 'th') * direction;
      if (compared) return compared;
      return cleanString_(right.created_at).localeCompare(cleanString_(left.created_at));
    });
    const total = rows.length;
    const pageSize = Math.max(10, Math.min(100, Number(filters.page_size) || 25));
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(pages, Number(filters.page) || 1));
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
    return ok_(toClientSafe_({ rows: rows, total: total, page: page, pageSize: pageSize, pages: pages }));
  } catch (error) { return fail_(error); }
}

function listPendingReviewBills() {
  try {
    setupIfNeeded_();
    return ok_(toClientSafe_(getPendingReviewRows_()));
  } catch (error) { return fail_(error); }
}

function getPendingReviewRows_() {
  return publicRows_(SHEETS.BILLS)
    .filter(function (bill) { return ['NEEDS_REVIEW', 'PENDING_CONFIRMATION'].indexOf(cleanString_(bill.status).toUpperCase()) >= 0; })
    .sort(function (left, right) {
      return cleanString_(right.updated_at || right.created_at).localeCompare(cleanString_(left.updated_at || left.created_at));
    })
    .map(function (bill) {
      return { bill_id: bill.bill_id, vendor_name: bill.vendor_name, document_no: bill.document_no, updated_at: bill.updated_at || bill.created_at };
    });
}

function getLatestActionableBillId_() {
  const rows = getPendingReviewRows_();
  return rows.length ? cleanString_(rows[0].bill_id) : '';
}
