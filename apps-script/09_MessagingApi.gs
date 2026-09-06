/**
 * Pure builder สำหรับนำไปใช้ตอนเชื่อม LINE Messaging API ภายหลัง
 * ไฟล์นี้ไม่ยิง LINE API และไม่ใช้ token โดยอัตโนมัติ
 */
function buildBillConfirmationFlex(billId, liffBaseUrl) {
  const bill = getBillDetail_(billId);
  const project = findById_(SHEETS.PROJECTS, 'project_id', bill.project_id) || {};
  const company = findById_(SHEETS.COMPANIES, 'company_id', bill.company_id) || {};
  const category = findById_(SHEETS.CATEGORIES, 'category_id', bill.category_id) || {};
  const companyNameMatch = bill.company_match === '' || bill.company_match == null
    ? !!normalizeThaiText_(bill.buyer_name) && normalizeThaiText_(bill.buyer_name) === normalizeThaiText_(company.company_name) : toBoolean_(bill.company_match);
  const taxIdMatch = bill.tax_id_match === '' || bill.tax_id_match == null
    ? !!normalizeTaxId_(bill.buyer_tax_id) && normalizeTaxId_(bill.buyer_tax_id) === normalizeTaxId_(company.tax_id) : toBoolean_(bill.tax_id_match);
  const addressMatch = bill.address_match === '' || bill.address_match == null
    ? isAddressMatch_(bill.buyer_address, company.address) : toBoolean_(bill.address_match);
  const appUrl = cleanString_(liffBaseUrl) || getFrontendAppUrl_();
  const editUrl = appendUrlParams_(appUrl, { openExternalBrowser: '1', bill_id: billId });
  const needsReview = toBoolean_(bill.needs_review);
  const warning = needsReview ? 'กรุณาตรวจสอบจุดที่ระบบแจ้งก่อนยืนยัน' : 'ข้อมูลสำคัญผ่านการตรวจสอบแล้ว';
  return {
    type: 'flex',
    altText: 'AI อ่านบิลเสร็จแล้ว · ' + (bill.document_no || billId.slice(0, 8)) + ' · ' + formatMoney_(bill.grand_total) + ' บาท',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#2D211C', paddingAll: '22px', contents: [
        { type: 'text', text: 'AI BILL CAPTURE', color: '#D6B77A', weight: 'bold', size: 'xs' },
        { type: 'text', text: bill.vendor_name || 'ไม่ทราบชื่อร้านค้า', color: '#FFFFFF', weight: 'bold', size: 'xl', wrap: true, margin: 'md' },
        { type: 'text', text: category.category_name || 'ยังไม่จัดกลุ่ม', color: '#E6D6C9', weight: 'bold', size: 'sm', margin: 'sm' },
        { type: 'text', text: (needsReview ? '⚠ ' : '✓ ') + warning, color: needsReview ? '#E7C17A' : '#D7C797', wrap: true, margin: 'lg', size: 'xs' },
      ] },
      body: { type: 'box', layout: 'vertical', backgroundColor: '#FFFDF9', paddingAll: '22px', spacing: 'md', contents: [
        { type: 'text', text: 'ข้อมูลที่ AI อ่านได้', color: '#795442', weight: 'bold', size: 'sm' },
        { type: 'separator', color: '#E7D9CA' },
        flexReviewRow_('โครงการ', project.project_name || '-'),
        flexReviewRow_('บริษัท', company.company_name || '-'),
        flexReviewRow_('ประเภท', docTypeThai_(bill.doc_type)),
        flexReviewRow_('เลขที่เอกสาร', bill.document_no || '-'),
        flexReviewRow_('วันที่', formatThaiDateLong_(bill.document_date)),
        { type: 'box', layout: 'vertical', backgroundColor: '#F7EDE1', cornerRadius: '12px', paddingAll: '16px', margin: 'md', contents: [
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'ก่อน VAT', color: '#79675C', size: 'xs', flex: 2 },
            { type: 'text', text: formatMoney_(bill.subtotal) + ' บาท', color: '#4B372F', size: 'xs', align: 'end', flex: 3 },
          ] },
          { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
            { type: 'text', text: 'VAT', color: '#79675C', size: 'xs', flex: 2 },
            { type: 'text', text: formatMoney_(bill.vat_amount) + ' บาท', color: '#4B372F', size: 'xs', align: 'end', flex: 3 },
          ] },
          { type: 'separator', color: '#DFCBB7', margin: 'md' },
          { type: 'text', text: 'ยอดสุทธิ', color: '#79675C', size: 'xs', margin: 'md' },
          { type: 'text', text: formatMoney_(bill.grand_total) + ' บาท', color: '#754631', size: 'xxl', weight: 'bold', align: 'end', margin: 'sm' },
        ] },
        { type: 'text', text: 'ผลตรวจสอบข้อมูลบริษัท', color: '#795442', weight: 'bold', size: 'sm', margin: 'md' },
        flexReviewCheckRow_('ชื่อบริษัท', companyNameMatch),
        flexReviewCheckRow_('เลขผู้เสียภาษี', taxIdMatch),
        flexReviewCheckRow_('ที่อยู่', addressMatch),
        flexReviewRow_('คุณภาพรูป', (bill.image_quality || '-') + ' · ' + (toNumber_(bill.quality_score) || 0) + '%'),
        flexReviewRow_('ผู้ส่ง', bill.source_user_id || '-'),
        { type: 'box', layout: 'vertical', backgroundColor: needsReview ? '#FFF5E4' : '#F6F3E8', cornerRadius: '10px', paddingAll: '12px', margin: 'md', contents: [
          { type: 'text', text: needsReview ? cleanString_(bill.review_reasons || 'กรุณาตรวจสอบข้อมูล', 500) : 'ชื่อ เลขผู้เสียภาษี และที่อยู่ตรงกับข้อมูลบริษัท', size: 'xs', color: needsReview ? '#925B2F' : '#66613F', wrap: true },
        ] },
      ] },
      footer: { type: 'box', layout: 'vertical', backgroundColor: '#FFFDF9', paddingAll: '18px', paddingTop: '4px', spacing: 'sm', contents: [
        { type: 'button', style: 'primary', height: 'md', color: '#8F5F42', action: { type: 'postback', label: 'ยืนยันและบันทึก', data: 'action=confirm_bill&bill_id=' + billId } },
        { type: 'button', style: 'secondary', height: 'md', color: '#5C4438', action: { type: 'uri', label: 'ดูและแก้ไขรายละเอียด', uri: editUrl } },
        { type: 'button', style: 'secondary', height: 'sm', color: '#A55343', action: { type: 'postback', label: 'ยกเลิกบิลนี้', data: 'action=cancel_bill&bill_id=' + billId } },
      ] },
    },
  };
}

function flexReviewRow_(label, value) {
  return { type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    { type: 'text', text: cleanString_(label), size: 'sm', color: '#8A776B', flex: 2 },
    { type: 'text', text: cleanString_(value || '-'), size: 'sm', weight: 'bold', color: '#382923', align: 'end', wrap: true, flex: 4 },
  ] };
}

function flexReviewCheckRow_(label, matched) {
  return { type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    { type: 'text', text: cleanString_(label), size: 'sm', color: '#8A776B', flex: 2 },
    { type: 'text', text: toBoolean_(matched) ? '✓ ตรงกัน' : '⚠ ควรตรวจสอบ', size: 'sm', weight: 'bold', color: toBoolean_(matched) ? '#6F6744' : '#A15C32', align: 'end', wrap: true, flex: 4 },
  ] };
}

function buildBillSavedFlex(billOrId, appBaseUrl) {
  const bill = typeof billOrId === 'string' ? getBillDetail_(billOrId) : billOrId;
  if (!bill || !bill.bill_id) throw new Error('ไม่พบข้อมูลบิลสำหรับสร้างข้อความยืนยัน');
  const detailUrl = appendUrlParams_(cleanString_(appBaseUrl) || getFrontendAppUrl_(), { openExternalBrowser: '1', bill_id: bill.bill_id });
  const reference = cleanString_(bill.document_no || bill.bill_id.slice(0, 8), 80);
  return {
    type: 'flex',
    altText: '✅ บันทึกบิลแล้ว · ' + reference + ' · ' + formatMoney_(bill.grand_total) + ' บาท',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#31473A', paddingAll: '22px', contents: [
        { type: 'box', layout: 'horizontal', alignItems: 'center', contents: [
          { type: 'box', layout: 'vertical', width: '44px', height: '44px', cornerRadius: '22px', backgroundColor: '#D8C48F', justifyContent: 'center', alignItems: 'center', contents: [
            { type: 'text', text: '✓', color: '#31473A', size: 'xl', weight: 'bold', align: 'center' },
          ] },
          { type: 'box', layout: 'vertical', flex: 1, margin: 'lg', contents: [
            { type: 'text', text: 'RECORD SAVED', color: '#D8C48F', size: 'xxs', weight: 'bold' },
            { type: 'text', text: 'บันทึกสำเร็จ', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm' },
          ] },
        ] },
        { type: 'text', text: 'ข้อมูลถูกยืนยันและจัดเก็บในระบบเรียบร้อยแล้ว', color: '#D9E3DA', size: 'xs', wrap: true, margin: 'lg' },
      ] },
      body: { type: 'box', layout: 'vertical', backgroundColor: '#F9FBF7', paddingAll: '22px', spacing: 'md', contents: [
        { type: 'text', text: bill.vendor_name || 'ไม่ทราบชื่อร้านค้า', size: 'lg', weight: 'bold', color: '#24362B', wrap: true },
        { type: 'text', text: 'ใบรับรองการบันทึกค่าใช้จ่าย', size: 'xs', color: '#728076' },
        { type: 'separator', color: '#DCE6DD' },
        flexSavedRow_('เลขที่เอกสาร', bill.document_no || '-'),
        flexSavedRow_('วันที่เอกสาร', formatThaiDateLong_(bill.document_date)),
        flexSavedRow_('โครงการ', bill.project_name || '-'),
        flexSavedRow_('หมวดค่าใช้จ่าย', bill.category_name || '-'),
        flexSavedRow_('บริษัท', bill.company_name || '-'),
        flexSavedRow_('บันทึกเมื่อ', formatThaiDateLong_(cleanString_(bill.confirmed_at || bill.updated_at).slice(0, 10))),
        { type: 'box', layout: 'vertical', backgroundColor: '#E8F0E8', borderColor: '#C9D9CB', borderWidth: '1px', cornerRadius: '14px', paddingAll: '16px', margin: 'md', contents: [
          { type: 'text', text: 'ยอดที่บันทึกเข้าระบบ', color: '#66756A', size: 'xs' },
          { type: 'text', text: formatMoney_(bill.grand_total) + ' บาท', color: '#31563C', size: 'xxl', weight: 'bold', align: 'end', margin: 'sm' },
        ] },
        { type: 'box', layout: 'horizontal', backgroundColor: '#DCEBDD', cornerRadius: '10px', paddingAll: '12px', margin: 'md', contents: [
          { type: 'text', text: '✓  สถานะ: บันทึกแล้ว', color: '#31563C', size: 'sm', weight: 'bold', align: 'center', flex: 1 },
        ] },
        { type: 'text', text: 'เลขอ้างอิง ' + bill.bill_id.slice(0, 8).toUpperCase(), color: '#8B988E', size: 'xxs', align: 'center', margin: 'lg' },
      ] },
      footer: { type: 'box', layout: 'vertical', backgroundColor: '#F9FBF7', paddingAll: '18px', paddingTop: '4px', contents: [
        { type: 'button', style: 'primary', height: 'md', color: '#42654B', action: { type: 'uri', label: 'ดูรายการที่บันทึกแล้ว', uri: detailUrl } },
        { type: 'text', text: 'เปิดดูรูป เอกสาร และข้อมูลที่จัดเก็บแล้ว', color: '#819086', size: 'xxs', align: 'center', wrap: true, margin: 'sm' },
      ] },
    },
  };
}

function flexSavedRow_(label, value) {
  return { type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    { type: 'text', text: cleanString_(label), color: '#7A887E', size: 'sm', flex: 2 },
    { type: 'text', text: cleanString_(value || '-'), color: '#2E4034', size: 'sm', weight: 'bold', align: 'end', wrap: true, flex: 4 },
  ] };
}

function flexRow_(label, value, highlight) {
  return { type: 'box', layout: 'horizontal', contents: [
    { type: 'text', text: label, size: 'sm', color: '#64748B', flex: 2 },
    { type: 'text', text: cleanString_(value), size: highlight ? 'md' : 'sm', weight: highlight ? 'bold' : 'regular', color: highlight ? '#047857' : '#0F172A', align: 'end', wrap: true, flex: 4 },
  ] };
}

function docTypeThai_(value) {
  const labels = { TAX_INVOICE: 'ใบกำกับภาษี', RECEIPT: 'ใบเสร็จรับเงิน', CASH_BILL: 'บิลเงินสด', INVOICE: 'ใบแจ้งหนี้', DELIVERY_NOTE: 'ใบส่งของ', TOLL: 'ค่าผ่านทาง/ทางด่วน', TRANSFER_SLIP: 'สลิปโอนเงิน', OTHER: 'เอกสารอื่นๆ' };
  return labels[value] || value || '-';
}

function formatMoney_(value) {
  return toNumber_(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
