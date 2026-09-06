function getQuickSettings() {
  try {
    setupIfNeeded_();
    return ok_(getQuickSettings_());
  } catch (error) { return fail_(error); }
}

function getQuickSettings_() {
  const slots = [1, 2].map(function (slot) { return getQuickSettingsSlot_(slot); });
  const primary = slots[0];
  const configuredCount = slots.filter(function (slot) { return slot.configured; }).length;
  const legacyDefault = primary.configured ? primary : (slots.find(function (slot) { return slot.configured; }) || primary);
  let message = 'ยังไม่ได้ตั้งค่าลัด';
  if (configuredCount === 1) message = 'มีค่าลัดพร้อมใช้งาน 1 ชุด';
  if (configuredCount === 2) message = 'มีค่าลัดพร้อมใช้งานครบ 2 ชุด';
  if (!configuredCount && slots.some(function (slot) { return slot.has_values; })) {
    message = 'ค่าลัดเดิมใช้งานไม่ได้ กรุณาตรวจสอบจำนวนหน้า โครงการ และบริษัท';
  }
  return {
    configured: legacyDefault.configured,
    has_values: legacyDefault.has_values,
    page_count: legacyDefault.page_count,
    project_id: legacyDefault.project_id,
    project_name: legacyDefault.project_name,
    company_id: legacyDefault.company_id,
    company_name: legacyDefault.company_name,
    slots: slots,
    configured_count: configuredCount,
    any_configured: configuredCount > 0,
    message: message,
  };
}

function getQuickSettingsSlot_(slot) {
  const slotNumber = normalizeQuickSettingSlot_(slot);
  const keys = quickSettingKeys_(slotNumber);
  const properties = PropertiesService.getScriptProperties();
  const raw = {
    page_count: properties.getProperty(keys.page_count) || '',
    project_id: properties.getProperty(keys.project_id) || '',
    company_id: properties.getProperty(keys.company_id) || '',
  };
  const hasValues = !!(raw.page_count || raw.project_id || raw.company_id);
  const pageCount = Number(raw.page_count) || 0;
  const project = raw.project_id ? findById_(SHEETS.PROJECTS, 'project_id', raw.project_id) : null;
  const company = raw.company_id ? findById_(SHEETS.COMPANIES, 'company_id', raw.company_id) : null;
  const valid = pageCount >= 1 && pageCount <= APP_CONFIG.MAX_PAGES_PER_BILL
    && !!project && toBoolean_(project.active)
    && !!company && toBoolean_(company.active);
  let message = 'ยังไม่ได้ตั้งค่าลัด ' + slotNumber;
  if (hasValues && !valid) message = 'ค่าลัดเดิมใช้งานไม่ได้ กรุณาเลือกจำนวนหน้า โครงการ และบริษัทใหม่';
  if (valid) message = 'ค่าลัด ' + slotNumber + ' พร้อมใช้ใน LINE และหน้าเพิ่มบิล';
  return {
    slot: slotNumber,
    label: 'ค่าลัด ' + slotNumber,
    configured: valid,
    has_values: hasValues,
    page_count: pageCount,
    project_id: raw.project_id,
    project_name: project ? cleanString_(project.project_name) : '',
    company_id: raw.company_id,
    company_name: company ? cleanString_(company.company_name) : '',
    message: message,
  };
}

function saveQuickSettings(payload) {
  try {
    setupIfNeeded_();
    payload = payload || {};
    const slot = normalizeQuickSettingSlot_(payload.slot);
    const projects = publicRows_(SHEETS.PROJECTS);
    const companies = publicRows_(SHEETS.COMPANIES);
    const clean = validateQuickSettingsSelection_(payload, projects, companies);
    return ok_(withScriptLock_(function () {
      const before = getQuickSettingsSlot_(slot);
      const keys = quickSettingKeys_(slot);
      const values = {};
      values[keys.page_count] = String(clean.page_count);
      values[keys.project_id] = clean.project_id;
      values[keys.company_id] = clean.company_id;
      PropertiesService.getScriptProperties().setProperties(values, false);
      const after = getQuickSettingsSlot_(slot);
      appendAudit_('quick_settings', 'slot_' + slot, 'UPDATE', before, after, 'WEB');
      return getQuickSettings_();
    }));
  } catch (error) { return fail_(error); }
}

function clearQuickSettings(slot) {
  try {
    setupIfNeeded_();
    const slotNumber = normalizeQuickSettingSlot_(slot);
    return ok_(withScriptLock_(function () {
      const before = getQuickSettingsSlot_(slotNumber);
      const keys = quickSettingKeys_(slotNumber);
      const properties = PropertiesService.getScriptProperties();
      properties.deleteProperty(keys.page_count);
      properties.deleteProperty(keys.project_id);
      properties.deleteProperty(keys.company_id);
      const after = getQuickSettingsSlot_(slotNumber);
      appendAudit_('quick_settings', 'slot_' + slotNumber, 'CLEAR', before, after, 'WEB');
      return getQuickSettings_();
    }));
  } catch (error) { return fail_(error); }
}

function normalizeQuickSettingSlot_(slot) {
  return Number(slot) === 2 ? 2 : 1;
}

function quickSettingKeys_(slot) {
  return normalizeQuickSettingSlot_(slot) === 2
    ? { page_count: PROP_KEYS.QUICK2_PAGE_COUNT, project_id: PROP_KEYS.QUICK2_PROJECT_ID, company_id: PROP_KEYS.QUICK2_COMPANY_ID }
    : { page_count: PROP_KEYS.QUICK_PAGE_COUNT, project_id: PROP_KEYS.QUICK_PROJECT_ID, company_id: PROP_KEYS.QUICK_COMPANY_ID };
}

function configuredQuickSettings_(settings) {
  const source = settings || {};
  const slots = Array.isArray(source.slots) ? source.slots : [Object.assign({ slot: 1, label: 'ค่าลัด 1' }, source)];
  return slots.filter(function (slot) { return slot && slot.configured; });
}

function getQuickSettingBySlot_(settings, slot) {
  const slotNumber = normalizeQuickSettingSlot_(slot);
  const slots = settings && Array.isArray(settings.slots) ? settings.slots : [];
  const matched = slots.find(function (item) { return Number(item.slot) === slotNumber; });
  if (matched) return matched;
  if (slotNumber === 1 && settings) return Object.assign({ slot: 1, label: 'ค่าลัด 1' }, settings);
  return { slot: slotNumber, label: 'ค่าลัด ' + slotNumber, configured: false, has_values: false, message: 'ยังไม่ได้ตั้งค่าลัด ' + slotNumber };
}

function validateQuickSettingsSelection_(payload, projects, companies) {
  const pageCount = Number(payload.page_count);
  const projectId = cleanString_(payload.project_id);
  const companyId = cleanString_(payload.company_id);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > APP_CONFIG.MAX_PAGES_PER_BILL) {
    throw new Error('จำนวนหน้าค่าลัดต้องอยู่ระหว่าง 1-' + APP_CONFIG.MAX_PAGES_PER_BILL);
  }
  const project = (projects || []).find(function (row) {
    return String(row.project_id) === projectId && toBoolean_(row.active);
  });
  const company = (companies || []).find(function (row) {
    return String(row.company_id) === companyId && toBoolean_(row.active);
  });
  if (!project) throw new Error('กรุณาเลือกโครงการที่ยังใช้งานอยู่');
  if (!company) throw new Error('กรุณาเลือกบริษัทที่ยังใช้งานอยู่');
  return {
    page_count: pageCount,
    project_id: projectId,
    project_name: cleanString_(project.project_name),
    company_id: companyId,
    company_name: cleanString_(company.company_name),
  };
}
