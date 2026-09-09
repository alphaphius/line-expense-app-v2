(function () {
  'use strict';

  const state = {
    loaded: false, enabled: false, templates: [], groups: [], projects: [], registrations: [],
    selectedFiles: [], batchId: '', draftRows: [], processing: false,
  };

  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  async function gas(method, ...args) {
    try {
      return await window.V2Api.call(method, ...args);
    } catch (error) {
      if (window.ProtectedAccess.isAuthError(error) && await window.ProtectedAccess.ensure()) return window.V2Api.call(method, ...args);
      throw error;
    }
  }

  async function protectedCallWithRequestId(method, requestId, payload) {
    try {
      return await window.V2Api.callWithRequestId(method, requestId, payload);
    } catch (error) {
      if (window.ProtectedAccess.isAuthError(error) && await window.ProtectedAccess.ensure()) return window.V2Api.callWithRequestId(method, requestId, payload);
      throw error;
    }
  }

  async function activate(force) {
    if (state.loaded && !force) return;
    try {
      const workspace = await gas('getReceiptWorkspace', readFilters());
      state.loaded = true;
      state.enabled = !!workspace.enabled;
      state.templates = workspace.templates || [];
      state.groups = workspace.groups || [];
      state.projects = workspace.projects || [];
      state.registrations = (workspace.registrations && workspace.registrations.rows) || [];
      renderWorkspace(workspace.securityMessage || '');
    } catch (error) {
      state.loaded = true;
      state.enabled = false;
      renderWorkspace(error.message);
    }
  }

  function renderWorkspace(securityMessage) {
    const gate = $('receipt-security-gate');
    gate.classList.toggle('hidden', state.enabled);
    $('receipt-workspace').classList.toggle('is-disabled', !state.enabled);
    if (securityMessage) $('receipt-security-message').textContent = securityMessage;
    ['receipt-template-select','receipt-group-select','receipt-card-files','receipt-template-file','receipt-template-name','receipt-new-group-btn'].forEach(id => {
      const element = $(id); if (element) element.disabled = !state.enabled;
    });
    renderOptions();
    renderRegistry();
  }

  function renderOptions() {
    const templateValue = $('receipt-template-select').value;
    $('receipt-template-select').innerHTML = '<option value="">เลือก Template</option>' + state.templates.map(row => `<option value="${escapeHtml(row.template_id)}">${escapeHtml(row.template_name)}</option>`).join('');
    if (state.templates.some(row => row.template_id === templateValue)) $('receipt-template-select').value = templateValue;
    const groupOptions = state.groups.map(row => `<option value="${escapeHtml(row.group_id)}">${escapeHtml(row.group_name)}${row.site_name ? ` · ${escapeHtml(row.site_name)}` : ''}</option>`).join('');
    const groupValue = $('receipt-group-select').value;
    $('receipt-group-select').innerHTML = '<option value="">เลือกกลุ่มแรงงาน</option>' + groupOptions;
    $('receipt-filter-group').innerHTML = '<option value="">ทุกกลุ่มแรงงาน</option>' + groupOptions;
    if (state.groups.some(row => row.group_id === groupValue)) $('receipt-group-select').value = groupValue;
  }

  function readFilters() {
    return { search: $('receipt-search') ? $('receipt-search').value.trim() : '', group_id: $('receipt-filter-group') ? $('receipt-filter-group').value : '', status: 'SAVED' };
  }

  function renderRegistry() {
    $('receipt-total-count').textContent = Number(state.registrations.length).toLocaleString('th-TH');
    const groupMap = Object.fromEntries(state.groups.map(group => [group.group_id, group]));
    $('receipt-registry-list').innerHTML = state.registrations.length ? state.registrations.map(row => {
      const group = groupMap[row.group_id] || {};
      return `<label class="receipt-registry-row">
        <input type="checkbox" data-receipt-select value="${escapeHtml(row.registration_id)}">
        <strong>${escapeHtml(row.full_name || '-')}</strong>
        <span>${escapeHtml(row.national_id_masked || '-')}</span>
        <span>${escapeHtml(group.group_name || '-')}</span>
        <small>${escapeHtml(group.site_name || row.updated_at || '')}</small>
      </label>`;
    }).join('') : '<div class="receipt-registry-empty">ยังไม่มีรายชื่อที่บันทึก เมื่อ OCR และตรวจสอบแล้ว รายชื่อจะปรากฏที่นี่</div>';
    updateSelection();
  }

  async function refreshRegistry() {
    const result = await gas('listReceiptRegistrations', readFilters());
    state.registrations = result.rows || [];
    renderRegistry();
  }

  function selectedRegistrationIds() {
    return Array.from(document.querySelectorAll('[data-receipt-select]:checked')).map(input => input.value);
  }

  function updateSelection() {
    const selected = selectedRegistrationIds();
    $('receipt-selection-count').textContent = `เลือก ${selected.length.toLocaleString('th-TH')} คน`;
    $('receipt-export-docx-btn').disabled = !state.enabled || !selected.length;
    $('receipt-export-excel-btn').disabled = !state.enabled || !selected.length;
    const all = Array.from(document.querySelectorAll('[data-receipt-select]'));
    $('receipt-select-all').checked = all.length > 0 && selected.length === all.length;
    $('receipt-select-all').indeterminate = selected.length > 0 && selected.length < all.length;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
  }

  async function saveTemplate(event) {
    event.preventDefault();
    if (!state.enabled) return;
    const form = event.currentTarget;
    const file = $('receipt-template-file').files[0];
    if (!file) return Swal.fire('กรุณาเลือกไฟล์ DOC หรือ DOCX','','warning');
    const name = $('receipt-template-name').value.trim() || file.name.replace(/\.docx?$/i, '');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await gas('saveReceiptTemplate', { template_name:name, file_name:file.name, data_url:await fileToDataUrl(file) });
      state.templates.push(result);
      renderOptions();
      $('receipt-template-select').value = result.template_id;
      form.reset();
      Swal.fire({ icon:'success', title:'บันทึก Template แล้ว', text:'ตรวจพบ Placeholder ครบและพร้อมสร้างเอกสาร', timer:1800, showConfirmButton:false });
    } catch (error) { Swal.fire('บันทึก Template ไม่สำเร็จ',error.message,'error'); }
    finally { button.disabled = false; }
  }

  async function createGroup() {
    if (!state.enabled) return;
    const projectOptions = state.projects.map(row => `<option value="${escapeHtml(row.project_id)}">${escapeHtml(row.project_name)}</option>`).join('');
    const result = await Swal.fire({
      title:'สร้างกลุ่มแรงงาน',
      html:`<div class="grid gap-3 text-left"><label class="text-sm">ชื่อกลุ่ม<input id="rg-name" class="swal2-input !m-0 !mt-1 !w-full" placeholder="เช่น ทีมเสาเข็ม ไซต์ A"></label><label class="text-sm">ประเภท<select id="rg-type" class="swal2-select !m-0 !mt-1 !w-full"><option value="SITE">แรงงานตามไซต์</option><option value="PERMANENT">แรงงานประจำ</option><option value="OTHER">กลุ่มอื่น</option></select></label><label id="rg-project-label" class="text-sm">ไซต์งาน<select id="rg-project" class="swal2-select !m-0 !mt-1 !w-full"><option value="">เลือกไซต์งาน</option>${projectOptions}</select></label></div>`,
      showCancelButton:true, confirmButtonText:'สร้างกลุ่ม', cancelButtonText:'ยกเลิก', confirmButtonColor:'#8f5f42',
      didOpen:popup => popup.querySelector('#rg-type').addEventListener('change', event => popup.querySelector('#rg-project-label').classList.toggle('hidden', event.target.value !== 'SITE')),
      preConfirm:() => ({ group_name:document.getElementById('rg-name').value.trim(), group_type:document.getElementById('rg-type').value, project_id:document.getElementById('rg-project').value }),
    });
    if (!result.isConfirmed) return;
    try {
      const group = await gas('saveLaborGroup', result.value);
      state.groups.push(group); renderOptions(); $('receipt-group-select').value = group.group_id;
      Swal.fire({ icon:'success', title:'สร้างกลุ่มแล้ว', timer:1400, showConfirmButton:false });
    } catch (error) { Swal.fire('สร้างกลุ่มไม่สำเร็จ',error.message,'error'); }
  }

  function chooseCardFiles(event) {
    const files = Array.from(event.target.files || []);
    if (files.length > 40) {
      event.target.value = '';
      state.selectedFiles = [];
      return Swal.fire('เลือกได้สูงสุด 40 รูปต่อชุด','','warning');
    }
    state.selectedFiles = files;
    $('receipt-selected-count').textContent = files.length.toLocaleString('th-TH');
    $('receipt-process-btn').disabled = !state.enabled || !files.length;
    $('receipt-upload-summary').classList.toggle('hidden', !files.length);
    $('receipt-upload-summary').textContent = files.length ? `เลือกแล้ว ${files.length.toLocaleString('th-TH')} รูป · ${(files.reduce((sum,file)=>sum+file.size,0)/(1024*1024)).toLocaleString('th-TH',{maximumFractionDigits:1})} MB ก่อนบีบอัด` : '';
  }

  async function processCards() {
    if (state.processing || !state.selectedFiles.length) return;
    const templateId = $('receipt-template-select').value;
    const groupId = $('receipt-group-select').value;
    if (!templateId || !groupId) return Swal.fire('กรุณาเลือก Template และกลุ่มแรงงาน','','warning');
    state.processing = true;
    $('receipt-process-btn').disabled = true;
    $('receipt-quick-edit-card').classList.remove('hidden');
    state.draftRows = state.selectedFiles.map((file,index) => ({ local_id:`local-${index}`, file, status:'QUEUED', full_name:'', national_id:'', address:'', warnings:[], error:'' }));
    renderDraftRows();
    try {
      const ocrRuntime = await window.OfflineThaiIdOcr.initialize(progress => {
        const percent = Math.round(Number(progress.progress || 0) * 100);
        $('receipt-batch-progress').textContent = `${progress.status} ${percent}% · โหลดครั้งแรกครั้งเดียว`;
      });
      const batch = await gas('createReceiptBatch', { template_id:templateId, group_id:groupId, total_count:state.selectedFiles.length, created_by:'WEB' });
      state.batchId = batch.batch_id;
      let next = 0;
      async function worker() {
        while (next < state.draftRows.length) {
          const index = next++;
          const row = state.draftRows[index];
          row.status = 'COMPRESSING'; renderDraftRow(index);
          try {
            const optimized = await window.ImageOptimizer.compressImage(row.file, { maxLongEdge:1600, targetBytes:700*1024, quality:.8, minQuality:.54 });
            row.status = 'OCR'; renderDraftRow(index);
            let lastProgress = -1;
            const ocr = await window.OfflineThaiIdOcr.recognize(optimized.dataUrl, progress => {
              const percent = Math.round(Number(progress.progress || 0) * 100);
              if (percent !== 100 && percent - lastProgress < 5) return;
              lastProgress = percent;
              row.ocr_label = `${progress.status} ${percent}%`;
              renderDraftRow(index);
            });
            const requestId = window.V2Api.newRequestId();
            const result = await protectedCallWithRequestId('saveReceiptCardDraft', requestId, {
              batch_id:state.batchId, file_name:optimized.name, data_url:optimized.dataUrl,
              original_size:optimized.originalSize, optimized_size:optimized.optimizedSize, ocr,
            });
            Object.assign(row, result, { status:'READY', ocr_label:'', warnings:String(result.ocr_warnings || '').split(' | ').filter(Boolean) });
          } catch (error) { Object.assign(row, { status:'ERROR', error:error.message }); }
          renderDraftRow(index); updateBatchProgress();
        }
      }
      await Promise.all(Array.from({ length:Math.min(ocrRuntime.workers,state.draftRows.length) }, worker));
    } catch (error) { Swal.fire('เริ่มประมวลผลไม่สำเร็จ',error.message,'error'); }
    finally {
      state.processing = false;
      $('receipt-process-btn').disabled = !state.enabled || !state.selectedFiles.length;
      updateBatchProgress();
    }
  }

  function draftRowHtml(row, index) {
    const loading = ['QUEUED','COMPRESSING','OCR'].includes(row.status);
    const duplicate = !!row.duplicate_type;
    const statusClass = row.status === 'ERROR' ? 'is-error' : duplicate ? 'is-duplicate' : loading ? 'is-loading' : '';
    const statusText = row.ocr_label || ({ QUEUED:'รอคิว',COMPRESSING:'กำลังบีบอัด',OCR:'OCR บนอุปกรณ์',READY:'พร้อมตรวจสอบ',ERROR:'ผิดพลาด' })[row.status] || row.status;
    const warning = row.error || (row.warnings || []).join(' · ') || (duplicate ? `พบข้อมูลซ้ำ (${row.duplicate_type})` : '');
    return `<div class="receipt-edit-row" data-draft-index="${index}">
      <span class="receipt-edit-row__index">${String(index+1).padStart(2,'0')}</span>
      <label>ชื่อ-นามสกุล<input class="field" data-draft-field="full_name" value="${escapeHtml(row.full_name)}" ${loading?'disabled':''}></label>
      <label>เลขบัตรประชาชน<input class="field" data-draft-field="national_id" inputmode="numeric" maxlength="17" value="${escapeHtml(row.national_id)}" ${loading?'disabled':''}></label>
      <label>ที่อยู่<textarea class="field" data-draft-field="address" ${loading?'disabled':''}>${escapeHtml(row.address)}</textarea></label>
      <div class="receipt-row-state"><span class="receipt-status-pill ${statusClass}">${escapeHtml(statusText)}</span>${warning?`<small class="receipt-row-warning">${escapeHtml(warning)}</small>`:''}${duplicate?'<label class="receipt-existing-check"><input type="checkbox" data-allow-existing> เชื่อมกับบุคคลเดิมที่พบ</label>':''}${row.status==='ERROR'?`<button type="button" class="secondary-btn" data-retry-card="${index}">ลองใหม่</button>`:''}</div>
    </div>`;
  }

  function renderDraftRows() { $('receipt-quick-edit-list').innerHTML = state.draftRows.map(draftRowHtml).join(''); updateBatchProgress(); }
  function renderDraftRow(index) {
    const current = document.querySelector(`[data-draft-index="${index}"]`);
    if (current) current.outerHTML = draftRowHtml(state.draftRows[index], index);
    else renderDraftRows();
  }
  function updateBatchProgress() {
    const ready = state.draftRows.filter(row => row.status === 'READY').length;
    const errors = state.draftRows.filter(row => row.status === 'ERROR').length;
    $('receipt-batch-progress').textContent = `${ready.toLocaleString('th-TH')} พร้อมตรวจสอบ · ${errors.toLocaleString('th-TH')} ผิดพลาด · ทั้งหมด ${state.draftRows.length.toLocaleString('th-TH')}`;
    $('receipt-save-all-btn').disabled = state.processing || !ready || errors > 0;
  }

  function syncDraftInputs() {
    document.querySelectorAll('[data-draft-index]').forEach(container => {
      const row = state.draftRows[Number(container.dataset.draftIndex)];
      container.querySelectorAll('[data-draft-field]').forEach(input => { row[input.dataset.draftField] = input.value.trim(); });
      row.allow_existing_worker = !!container.querySelector('[data-allow-existing]:checked');
    });
  }

  async function saveAll() {
    syncDraftInputs();
    const rows = state.draftRows.filter(row => row.status === 'READY').map(row => ({
      registration_id:row.registration_id, full_name:row.full_name, national_id:row.national_id,
      address:row.address, allow_existing_worker:row.allow_existing_worker,
    }));
    if (!rows.length) return;
    $('receipt-save-all-btn').disabled = true;
    try {
      const result = await gas('saveReceiptRegistrations', { batch_id:state.batchId, rows });
      await refreshRegistry();
      state.draftRows = []; state.selectedFiles = []; $('receipt-card-files').value = '';
      $('receipt-quick-edit-card').classList.add('hidden'); $('receipt-upload-summary').classList.add('hidden'); $('receipt-selected-count').textContent = '0';
      Swal.fire({ icon:'success', title:`บันทึกแล้ว ${result.count.toLocaleString('th-TH')} คน`, text:'worker_id พร้อมเชื่อมระบบเช็กชื่อและค่าแรง', timer:2200, showConfirmButton:false });
    } catch (error) { Swal.fire('บันทึกไม่สำเร็จ',error.message,'error'); }
    finally { updateBatchProgress(); }
  }

  async function retryCard(index) {
    const row = state.draftRows[index];
    if (!row || state.processing) return;
    row.status = 'COMPRESSING'; row.error = ''; renderDraftRow(index);
    try {
      const optimized = await window.ImageOptimizer.compressImage(row.file, { maxLongEdge:1600, targetBytes:700*1024, quality:.8, minQuality:.54 });
      row.status = 'OCR'; renderDraftRow(index);
      const ocr = await window.OfflineThaiIdOcr.recognize(optimized.dataUrl, progress => {
        row.ocr_label = `${progress.status} ${Math.round(Number(progress.progress || 0) * 100)}%`;
        renderDraftRow(index);
      });
      const result = await gas('saveReceiptCardDraft', { batch_id:state.batchId, file_name:optimized.name, data_url:optimized.dataUrl, ocr });
      Object.assign(row,result,{status:'READY',warnings:String(result.ocr_warnings||'').split(' | ').filter(Boolean)});
    } catch (error) { row.status='ERROR'; row.error=error.message; }
    renderDraftRow(index); updateBatchProgress();
  }

  async function exportSelected(format) {
    const ids = selectedRegistrationIds();
    if (!ids.length) return;
    try {
      const preview = await gas('previewReceiptExport', { registration_ids:ids });
      const groupsHtml = preview.groups.map(group => `<section class="mb-3 rounded-xl border border-slate-200 p-3 text-left"><strong class="text-sm">${escapeHtml(group.group_name)}</strong>${group.site_name?`<p class="text-xs text-slate-500">ไซต์งาน: ${escapeHtml(group.site_name)}</p>`:''}<p class="mt-2 text-xs text-slate-600">${group.people.map(person=>escapeHtml(person.full_name)).join(' · ')}</p></section>`).join('');
      const confirm = await Swal.fire({ title:`ตรวจสอบก่อน Export ${format}`, html:`<p class="mb-4 text-left text-sm">ทั้งหมด <strong>${preview.total.toLocaleString('th-TH')} คน</strong> จาก ${preview.groups.length.toLocaleString('th-TH')} กลุ่ม</p><div class="max-h-80 overflow-auto">${groupsHtml}</div>`, showCancelButton:true, confirmButtonText:`สร้าง ${format}`, cancelButtonText:'กลับไปแก้ไข', confirmButtonColor:'#8f5f42', width:620 });
      if (!confirm.isConfirmed) return;
      const action = format === 'DOCX' ? 'exportReceiptDocuments' : 'exportReceiptRosterExcel';
      const file = await gas(action, { registration_ids:ids, template_id:$('receipt-template-select').value, force_template:true, created_by:'WEB' });
      await showDownload(file, format);
    } catch (error) { Swal.fire(`Export ${format} ไม่สำเร็จ`,error.message,'error'); }
  }

  async function showDownload(file, format) {
    let busy = false;
    await Swal.fire({
      icon:'success', title:`${format} พร้อมดาวน์โหลด`,
      html:`<p class="mb-4 text-sm text-slate-500">${Number(file.count||0).toLocaleString('th-TH')} คน · ${formatFileSize(file.sizeBytes)}</p><div class="export-download-grid export-download-grid--single"><a href="#" data-receipt-download>ดาวน์โหลด ${format}<small data-receipt-download-progress>ไฟล์พร้อมแล้ว</small></a></div>`,
      confirmButtonText:'ปิด', confirmButtonColor:'#8f5f42',
      didOpen:popup => popup.querySelector('[data-receipt-download]').addEventListener('click', async event => {
        event.preventDefault(); if (busy) return; busy=true;
        try { await downloadExportFile(file, percent => { popup.querySelector('[data-receipt-download-progress]').textContent=`กำลังเตรียมไฟล์ ${percent}%`; }); popup.querySelector('[data-receipt-download-progress]').textContent='ดาวน์โหลดสำเร็จ'; }
        catch (error) { Swal.showValidationMessage(error.message); }
        finally { busy=false; }
      }),
    });
  }

  function decodeBase64Bytes(base64) { const binary=atob(base64||''); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i); return bytes; }
  async function downloadExportFile(result,onProgress) {
    const chunks=[]; const total=Number(result.sizeBytes)||0; let offset=0;
    while(offset<total){ const chunk=await gas('getExportFileChunk',result.downloadToken,offset); if(!chunk||Number(chunk.offset)!==offset||Number(chunk.nextOffset)<=offset||!chunk.base64) throw new Error('ได้รับข้อมูลไฟล์ไม่ครบ'); chunks.push(decodeBase64Bytes(chunk.base64)); offset=Number(chunk.nextOffset); if(onProgress)onProgress(Math.min(100,Math.round(offset/total*100))); }
    const url=URL.createObjectURL(new Blob(chunks,{type:result.mimeType||'application/octet-stream'})); const link=document.createElement('a'); link.href=url; link.download=result.fileName||'export-file'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function formatFileSize(bytes){ const size=Number(bytes)||0; return size>=1024*1024?`${(size/(1024*1024)).toLocaleString('th-TH',{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(size/1024)).toLocaleString('th-TH')} KB`; }

  function bind() {
    $('receipt-template-form').addEventListener('submit',saveTemplate);
    $('receipt-new-group-btn').addEventListener('click',createGroup);
    $('receipt-card-files').addEventListener('change',chooseCardFiles);
    $('receipt-process-btn').addEventListener('click',processCards);
    $('receipt-save-all-btn').addEventListener('click',saveAll);
    $('receipt-search-btn').addEventListener('click',()=>refreshRegistry().catch(error=>Swal.fire('ค้นหาไม่สำเร็จ',error.message,'error')));
    $('receipt-search').addEventListener('keydown',event=>{if(event.key==='Enter')refreshRegistry().catch(()=>{});});
    $('receipt-filter-group').addEventListener('change',()=>refreshRegistry().catch(()=>{}));
    $('receipt-select-all').addEventListener('change',event=>{document.querySelectorAll('[data-receipt-select]').forEach(input=>{input.checked=event.target.checked;});updateSelection();});
    $('receipt-registry-list').addEventListener('change',event=>{if(event.target.matches('[data-receipt-select]'))updateSelection();});
    $('receipt-quick-edit-list').addEventListener('click',event=>{const button=event.target.closest('[data-retry-card]');if(button)retryCard(Number(button.dataset.retryCard));});
    $('receipt-export-docx-btn').addEventListener('click',()=>exportSelected('DOCX'));
    $('receipt-export-excel-btn').addEventListener('click',()=>exportSelected('Excel'));
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded',bind) : bind();
  window.ReceiptModule = Object.freeze({ activate });
})();
