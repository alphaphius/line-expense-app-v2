(function () {
  'use strict';

  const state = {
    loaded: false, enabled: false, templates: [], groups: [], projects: [], reportSites: [], registrations: [],
    selectedFiles: [], batchId: '', draftRows: [], processing: false, activeBatch: null, aiModel: '', selectedGroupIds:new Set(), groupFilterNone:false, previewCache:new Map(),
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
      state.reportSites = workspace.reportSites || [];
      state.registrations = (workspace.registrations && workspace.registrations.rows) || [];
      state.aiModel = workspace.aiModel || '';
      state.activeBatch = workspace.activeBatch || null;
      renderWorkspace(workspace.securityMessage || '');
      restoreActiveBatch();
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
    ['receipt-template-select','receipt-group-select','receipt-card-files','receipt-template-file','receipt-template-name','receipt-template-manage-btn','receipt-new-group-btn'].forEach(id => {
      const element = $(id); if (element) element.disabled = !state.enabled;
    });
    renderOptions();
    renderRegistry();
    renderSelectedFiles();
  }

  function renderOptions() {
    const templateValue = $('receipt-template-select').value;
    $('receipt-template-select').innerHTML = '<option value="">เลือก Template</option>' + state.templates.map(row => `<option value="${escapeHtml(row.template_id)}">${escapeHtml(row.template_name)}</option>`).join('');
    if (state.templates.some(row => row.template_id === templateValue)) $('receipt-template-select').value = templateValue;
    const groupOptions = state.groups.map(row => `<option value="${escapeHtml(row.group_id)}">${escapeHtml(row.group_name)}${row.site_code ? ` · ${escapeHtml(row.site_code)}${row.province?` · ${escapeHtml(row.province)}`:''}` : row.site_name ? ` · ${escapeHtml(row.site_name)}` : ''}</option>`).join('');
    const groupValue = $('receipt-group-select').value;
    $('receipt-group-select').innerHTML = '<option value="">เลือกกลุ่มแรงงาน</option>' + groupOptions;
    if (state.groups.some(row => row.group_id === groupValue)) $('receipt-group-select').value = groupValue;
    renderGroupFilter();
  }

  function renderGroupFilter() {
    const options=$('receipt-filter-group-options');if(!options)return;
    state.selectedGroupIds=new Set([...state.selectedGroupIds].filter(id=>state.groups.some(group=>group.group_id===id)));
    const all=!state.groupFilterNone&&state.selectedGroupIds.size===0;
    options.innerHTML=`<div class="receipt-group-filter__tools"><button type="button" data-group-filter-all>เลือกทั้งหมด</button><button type="button" data-group-filter-none>ไม่เลือกทั้งหมด</button></div>${state.groups.map(group=>`<label><input type="checkbox" value="${escapeHtml(group.group_id)}" data-group-filter-check ${all||state.selectedGroupIds.has(group.group_id)?'checked':''}><span><strong>${escapeHtml(group.group_name)}</strong><small>${escapeHtml([group.site_code,group.province].filter(Boolean).join(' · '))}</small></span></label>`).join('')}`;
    const summary=$('receipt-filter-group').querySelector('summary');
    summary.textContent=all?'ทุกกลุ่มแรงงาน':state.groupFilterNone?'ยังไม่เลือกกลุ่ม':`เลือก ${state.selectedGroupIds.size.toLocaleString('th-TH')} กลุ่ม`;
  }

  function serverDraft(row) {
    return Object.assign({}, row, {
      status:row.status || 'AI_QUEUED',
      full_name:row.full_name || '', national_id:row.national_id || '', address:row.address || '', nickname:row.nickname||'', daily_wage:Number(row.daily_wage)||0, note:row.note||'', preview_url:row.preview_url||'',
      warnings:String(row.ocr_warnings || '').split(' | ').filter(Boolean), error:row.ai_last_error || '', file:null,
    });
  }

  function restoreActiveBatch() {
    const active=state.activeBatch;
    if(!active||!active.batch||!(active.rows||[]).length)return;
    state.batchId=active.batch.batch_id;
    state.draftRows=active.rows.map(serverDraft);
    $('receipt-template-select').value=active.batch.template_id;
    $('receipt-group-select').value=active.batch.group_id;
    $('receipt-quick-edit-card').classList.remove('hidden');
    renderDraftRows();
  }

  function readFilters() {
    return { search: $('receipt-search') ? $('receipt-search').value.trim() : '', group_ids:state.groupFilterNone?['__none__']:[...state.selectedGroupIds], status: 'SAVED' };
  }

  function renderRegistry() {
    $('receipt-total-count').textContent = Number(state.registrations.length).toLocaleString('th-TH');
    const groupMap = Object.fromEntries(state.groups.map(group => [group.group_id, group]));
    const grouped = new Map();
    state.registrations.forEach(row=>{const group=groupMap[row.group_id]||{},key=row.group_id||'ungrouped',entry=grouped.get(key)||{group,rows:[]};entry.rows.push(row);grouped.set(key,entry);});
    $('receipt-registry-list').innerHTML = state.registrations.length ? [...grouped.entries()].map(([groupId,entry]) => {
      const groupName=entry.group.group_name||entry.rows[0]?.group_name||'ไม่ระบุกลุ่ม',siteDetail=[entry.group.site_code||entry.rows[0]?.site_code,entry.group.province||entry.rows[0]?.province].filter(Boolean).join(' · ');
      const rows=entry.rows.map(row=>`<div class="receipt-registry-row ${Number(row.include_receipt_item)===0?'is-item-omitted':''}" data-registry-id="${escapeHtml(row.registration_id)}">
        <label class="receipt-registry-check" aria-label="เลือก ${escapeHtml(row.full_name||'รายชื่อนี้')}"><input type="checkbox" data-receipt-select value="${escapeHtml(row.registration_id)}"></label>
        <span class="receipt-person"><strong>${escapeHtml(row.full_name || '-')}</strong><small>${escapeHtml(row.nickname?`ชื่อเล่น ${row.nickname}`:'ยังไม่ระบุชื่อเล่น')} · ${escapeHtml(row.national_id_masked||'-')}</small></span>
        <span class="receipt-registry-wage">${Number(row.daily_wage||0).toLocaleString('th-TH')} บาท/วัน<small>${escapeHtml(row.note||'ไม่มีหมายเหตุ')}</small></span>
        <label class="receipt-item-choice"><input type="checkbox" data-receipt-item-toggle="${escapeHtml(row.registration_id)}" ${Number(row.include_receipt_item)!==0?'checked':''}><span>ใส่รายการรับเงิน<small>${escapeHtml(row.receipt_item||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ')}</small></span></label>
        <button type="button" class="receipt-row-edit-btn" data-receipt-edit="${escapeHtml(row.registration_id)}">แก้ไข</button>
      </div>`).join('');
      return `<section class="receipt-registry-group" data-group-id="${escapeHtml(groupId)}"><header><div><span>กลุ่มแรงงาน</span><strong>${escapeHtml(groupName)}</strong>${siteDetail?`<small>${escapeHtml(siteDetail)}</small>`:''}</div><b>${entry.rows.length.toLocaleString('th-TH')} คน</b></header><div class="receipt-registry-group__rows">${rows}</div></section>`;
    }).join('') : '<div class="receipt-registry-empty">ยังไม่มีรายชื่อที่บันทึก เมื่อ AI อ่านและตรวจสอบแล้ว รายชื่อจะปรากฏที่นี่</div>';
    updateSelection();
  }

  async function refreshRegistry() {
    const result = await gas('listReceiptRegistrations', readFilters());
    state.registrations = result.rows || [];
    renderRegistry();
  }

  async function refresh() {
    if (!state.loaded || state.processing || document.querySelector('#view-receipts dialog[open]')) return;
    if(state.batchId&&state.draftRows.length){syncDraftInputs();const workspace=await gas('getReceiptWorkspace',readFilters());state.registrations=workspace.registrations?.rows||[];if(workspace.activeBatch?.batch?.batch_id===state.batchId){const local=new Map(state.draftRows.map(row=>[row.registration_id,row]));workspace.activeBatch.rows=(workspace.activeBatch.rows||[]).map(row=>Object.assign(serverDraft(row),local.get(row.registration_id)&&{full_name:local.get(row.registration_id).full_name,national_id:local.get(row.registration_id).national_id,address:local.get(row.registration_id).address,nickname:local.get(row.registration_id).nickname,daily_wage:local.get(row.registration_id).daily_wage,note:local.get(row.registration_id).note}));state.activeBatch=workspace.activeBatch;state.draftRows=workspace.activeBatch.rows;renderDraftRows();}renderRegistry();return;}
    await refreshRegistry();
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
      renderTemplateFileState(null,{saved:true,fileName:file.name,templateName:result.template_name});
      Swal.fire({ icon:'success', title:'บันทึก Template แล้ว', text:'ตรวจพบ Placeholder ครบและพร้อมสร้างเอกสาร', timer:1800, showConfirmButton:false });
    } catch (error) { Swal.fire('บันทึก Template ไม่สำเร็จ',error.message,'error'); }
    finally { button.disabled = false; }
  }

  function templatePlaceholders(row){try{return Array.isArray(row.placeholders)?row.placeholders:JSON.parse(row.placeholders||'[]');}catch{return[];}}

  function renderTemplateFileState(file,success){const field=$('receipt-template-file-field'),stateBox=$('receipt-template-upload-state');field.classList.toggle('is-ready',!!file);$('receipt-template-file-title').textContent=file?`พร้อมอัปโหลด: ${file.name}`:'เลือกไฟล์ DOC หรือ DOCX';$('receipt-template-file-help').textContent=file?`${formatFileSize(file.size)} · กด “บันทึก Template” เพื่อเพิ่มเข้าระบบ`:'{ชื่อสกุล} · {เลขบัตร} · {ที่อยู่} · {รายการรับเงิน}';stateBox.classList.toggle('hidden',!success);stateBox.innerHTML=success?`<span aria-hidden="true">✓</span><div><strong>บันทึกในระบบแล้ว</strong><small>${escapeHtml(success.templateName)} · ไฟล์ ${escapeHtml(success.fileName)}</small></div>`:'';}

  async function downloadTemplate(templateId,button){const template=state.templates.find(row=>row.template_id===templateId);if(!template||button.disabled)return;const original=button.textContent;button.disabled=true;button.textContent='กำลังเตรียม…';try{const file=await gas('downloadReceiptTemplate',{template_id:templateId});await downloadExportFile(file,percent=>{button.textContent=`ดาวน์โหลด ${percent}%`;});button.textContent='ดาวน์โหลดแล้ว';setTimeout(()=>{button.textContent=original;button.disabled=false;},1300);}catch(error){button.textContent=original;button.disabled=false;Swal.fire('ดาวน์โหลด Template ไม่สำเร็จ',error.message,'error');}}

  async function showTemplateManager() {
    const list=state.templates.length?state.templates.map(row=>`<div class="receipt-template-manager__row"><div class="receipt-template-manager__file"><span aria-hidden="true">${escapeHtml((row.source_format||'DOCX').slice(0,1))}</span><div><strong>${escapeHtml(row.template_name)}</strong><small>ไฟล์ ${escapeHtml(row.source_file_name||`${row.template_name}.${String(row.source_format||'DOCX').toLowerCase()}`)}</small><p>${escapeHtml(row.source_format||'DOCX')} · ${Number(row.page_count||1).toLocaleString('th-TH')} หน้า · ${templatePlaceholders(row).map(escapeHtml).join(' · ')}</p></div></div><div class="receipt-template-manager__actions"><button type="button" data-template-download="${escapeHtml(row.template_id)}">ดาวน์โหลด</button><button type="button" class="is-danger" data-template-delete="${escapeHtml(row.template_id)}">ลบ</button></div></div>`).join(''):'<p class="receipt-template-manager__empty">ยังไม่มี Template</p>';
    await Swal.fire({title:'จัดการ Template',html:`<div class="receipt-template-manager">${list}</div>`,confirmButtonText:'ปิด',confirmButtonColor:'#8f5f42',width:720,didOpen:popup=>popup.addEventListener('click',async event=>{const download=event.target.closest('[data-template-download]');if(download){await downloadTemplate(download.dataset.templateDownload,download);return;}const button=event.target.closest('[data-template-delete]');if(!button)return;const template=state.templates.find(row=>row.template_id===button.dataset.templateDelete);const confirmed=await Swal.fire({icon:'warning',title:'ลบ Template นี้?',text:template?.template_name||'',showCancelButton:true,confirmButtonText:'ลบ Template',cancelButtonText:'ยกเลิก',confirmButtonColor:'#b64d3e'});if(!confirmed.isConfirmed)return;try{await protectedCallWithRequestId('deleteReceiptTemplate',window.V2Api.newRequestId(),{template_id:button.dataset.templateDelete});state.templates=state.templates.filter(row=>row.template_id!==button.dataset.templateDelete);renderOptions();await Swal.fire({icon:'success',title:'ลบ Template แล้ว',timer:1200,showConfirmButton:false});showTemplateManager();}catch(error){await Swal.fire('ลบ Template ไม่สำเร็จ',error.message,'error');showTemplateManager();}})});
  }

  async function createGroup() {
    if (!state.enabled) return;
    const projectOptions = state.projects.map(row => `<option value="${escapeHtml(row.project_id)}">${escapeHtml(row.project_name)}</option>`).join('');
    const reportSiteOptions=state.reportSites.map(site=>`<option value="${escapeHtml(site.report_site_id)}">${escapeHtml(`${site.site_id}-${site.site_code}-${site.province||'ไม่ระบุจังหวัด'}`)}</option>`).join('');
    const result = await Swal.fire({
      title:'สร้างกลุ่มแรงงาน',
      html:`<div class="grid gap-3 text-left"><label class="text-sm">ประเภท<select id="rg-type" class="swal2-select !m-0 !mt-1 !w-full"><option value="SITE">แรงงานตามไซต์</option><option value="PERMANENT">แรงงานประจำ</option><option value="OTHER">กลุ่มอื่น</option></select></label><label id="rg-source-label" class="text-sm">วิธีสร้าง<select id="rg-source" class="swal2-select !m-0 !mt-1 !w-full"><option value="REPORT">เลือกไซต์จากส่วนรายงาน</option><option value="PROJECT">เลือกโครงการเดิม</option><option value="MANUAL">กรอกชื่อเอง</option></select></label><label id="rg-report-label" class="text-sm">ไซต์จากรายงาน<select id="rg-report" class="swal2-select !m-0 !mt-1 !w-full"><option value="">เลือก SiteID-SiteCode-จังหวัด</option>${reportSiteOptions}</select></label><label id="rg-project-label" class="text-sm hidden">โครงการเดิม<select id="rg-project" class="swal2-select !m-0 !mt-1 !w-full"><option value="">เลือกไซต์งาน</option>${projectOptions}</select></label><label id="rg-name-label" class="text-sm hidden">ชื่อกลุ่ม<input id="rg-name" class="swal2-input !m-0 !mt-1 !w-full" placeholder="เช่น ทีมเสาเข็ม ไซต์ A"></label></div>`,
      showCancelButton:true, confirmButtonText:'สร้างกลุ่ม', cancelButtonText:'ยกเลิก', confirmButtonColor:'#8f5f42',
      didOpen:popup => {const sync=()=>{const site=popup.querySelector('#rg-type').value==='SITE',source=popup.querySelector('#rg-source').value;popup.querySelector('#rg-source-label').classList.toggle('hidden',!site);popup.querySelector('#rg-report-label').classList.toggle('hidden',!site||source!=='REPORT');popup.querySelector('#rg-project-label').classList.toggle('hidden',!site||source!=='PROJECT');popup.querySelector('#rg-name-label').classList.toggle('hidden',site&&source!=='MANUAL');};popup.querySelector('#rg-type').addEventListener('change',sync);popup.querySelector('#rg-source').addEventListener('change',sync);sync();},
      preConfirm:() => ({ group_name:document.getElementById('rg-name').value.trim(), group_type:document.getElementById('rg-type').value, project_id:document.getElementById('rg-source').value==='PROJECT'?document.getElementById('rg-project').value:'',report_site_id:document.getElementById('rg-source').value==='REPORT'?document.getElementById('rg-report').value:'' }),
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
      renderSelectedFiles();
      return Swal.fire('เลือกได้สูงสุด 40 รูปต่อชุด','','warning');
    }
    state.selectedFiles = files;
    renderSelectedFiles();
  }

  function renderSelectedFiles(){const files=state.selectedFiles,total=files.reduce((sum,file)=>sum+file.size,0),ready=files.length>0,dropzone=$('receipt-card-dropzone');$('receipt-selected-count').textContent=files.length.toLocaleString('th-TH');$('receipt-process-btn').disabled=!state.enabled||!ready;dropzone.classList.toggle('is-ready',ready);$('receipt-dropzone-icon').textContent=ready?'✓':'＋';$('receipt-dropzone-title').textContent=ready?`เตรียมอัปโหลดแล้ว ${files.length.toLocaleString('th-TH')} รูป`:'เลือกรูปบัตรประชาชน';$('receipt-dropzone-help').textContent=ready?'แตะบริเวณนี้เพื่อเลือกไฟล์ใหม่':'JPG, PNG, WEBP · บีบอัดและบันทึกบน NAS ก่อนส่งให้ Gemini';const summary=$('receipt-upload-summary');summary.classList.toggle('hidden',!ready);summary.innerHTML=ready?`<div class="receipt-upload-summary__head"><span><strong>พร้อมอัปโหลด</strong><small>${(total/(1024*1024)).toLocaleString('th-TH',{maximumFractionDigits:1})} MB ก่อนบีบอัด</small></span><button type="button" data-clear-receipt-files>ล้างรายการ</button></div><div class="receipt-upload-files">${files.map((file,index)=>`<span><b>${index+1}</b><em>${escapeHtml(file.name)}</em><small>${formatFileSize(file.size)}</small></span>`).join('')}</div>`:'';}

  function clearSelectedFiles(){state.selectedFiles=[];$('receipt-card-files').value='';renderSelectedFiles();}

  async function processCards() {
    if (state.processing || !state.selectedFiles.length) return;
    if(state.batchId&&state.draftRows.length)return Swal.fire('มีชุดที่กำลังทำอยู่','กรุณาตรวจสอบ บันทึก หรือกดทำต่อด้วย AI ให้ชุดปัจจุบันเสร็จก่อน','info');
    const templateId = $('receipt-template-select').value;
    const groupId = $('receipt-group-select').value;
    if (!templateId || !groupId) return Swal.fire('กรุณาเลือก Template และกลุ่มแรงงาน','','warning');
    state.processing = true;
    $('receipt-process-btn').disabled = true;
    $('receipt-quick-edit-card').classList.remove('hidden');
    state.draftRows = state.selectedFiles.map((file,index) => ({ local_id:`local-${index}`, file, preview_url:URL.createObjectURL(file), status:'UPLOAD_QUEUED', full_name:'', national_id:'', address:'', nickname:'', daily_wage:0, note:'', warnings:[], error:'' }));
    renderDraftRows();
    try {
      const batch = await gas('createReceiptBatch', { template_id:templateId, group_id:groupId, total_count:state.selectedFiles.length, created_by:'WEB' });
      state.batchId = batch.batch_id;
      let next = 0;
      async function uploadWorker() {
        while (next < state.draftRows.length) {
          const index = next++;
          const row = state.draftRows[index];
          row.status = 'COMPRESSING'; renderDraftRow(index);
          try {
            const optimized = await window.ImageOptimizer.compressImage(row.file, { maxLongEdge:1600, targetBytes:750*1024, quality:.82, minQuality:.58 });
            row.status = 'UPLOADING'; renderDraftRow(index);
            const requestId = window.V2Api.newRequestId();
            const result = await protectedCallWithRequestId('queueReceiptCard', requestId, {
              batch_id:state.batchId, file_name:optimized.name, data_url:optimized.dataUrl,
              original_size:optimized.originalSize, optimized_size:optimized.optimizedSize,
            });
            Object.assign(row,serverDraft(result),{file:null,preview_url:row.preview_url});
          } catch (error) { Object.assign(row, { status:'UPLOAD_ERROR', error:error.message }); }
          renderDraftRow(index); updateBatchProgress();
        }
      }
      await Promise.all(Array.from({ length:Math.min(3,state.draftRows.length) }, uploadWorker));
      if(state.draftRows.some(row=>row.status==='AI_QUEUED'))await resumeBatchAI(false);
    } catch (error) { Swal.fire('เริ่มประมวลผลไม่สำเร็จ',error.message,'error'); }
    finally {
      state.processing = false;
      $('receipt-process-btn').disabled = !state.enabled || !state.selectedFiles.length;
      updateBatchProgress();
    }
  }

  function mergeBatchRows(result) {
    const rows=(result&&result.rows)||[];
    rows.forEach(serverRow=>{
      const index=state.draftRows.findIndex(row=>row.registration_id===serverRow.registration_id);
      const normalized=serverDraft(serverRow);
      if(index>=0)state.draftRows[index]=Object.assign(state.draftRows[index],normalized);
      else state.draftRows.push(normalized);
    });
    if(result&&result.batch)state.activeBatch={batch:result.batch,rows:result.rows||[],counts:result.counts||{},pending:result.pending||0};
    renderDraftRows();
  }

  async function resumeBatchAI(includeRetry=true,registrationIds=[]) {
    if(state.processing&&includeRetry)return;
    const ownsProcessing=!state.processing;
    if(ownsProcessing)state.processing=true;
    $('receipt-resume-ai-btn').disabled=true;
    try {
      let allowRetry=includeRetry,guard=0;
      while(guard++<10){
        const requestId=window.V2Api.newRequestId();
        const result=await protectedCallWithRequestId('processReceiptBatchAI',requestId,{batch_id:state.batchId,registration_ids:registrationIds,include_retry:allowRetry});
        mergeBatchRows(result);
        registrationIds=[];allowRetry=false;
        if(result.waiting||!result.processed||!result.counts||!result.counts.queued) {
          if(result.waiting)await Swal.fire({icon:'info',title:'เก็บรูปไว้แล้ว',text:result.error||'Gemini ยังไม่พร้อม รูปทั้งหมดอยู่บน NAS กดทำต่อด้วย AI ภายหลังได้',confirmButtonColor:'#8f5f42'});
          break;
        }
      }
    } catch(error){await Swal.fire('AI อ่านข้อมูลไม่สำเร็จ',`${error.message}\nรูปที่อัปโหลดสำเร็จยังเก็บอยู่บน NAS`,'error');}
    finally{if(ownsProcessing)state.processing=false;$('receipt-resume-ai-btn').disabled=false;updateBatchProgress();}
  }

  function draftRowHtml(row, index) {
    const loading = ['UPLOAD_QUEUED','COMPRESSING','UPLOADING','AI_QUEUED','AI_PROCESSING'].includes(row.status);
    const duplicate = !!row.duplicate_type;
    const failed = ['UPLOAD_ERROR','AI_RETRY','AI_FAILED'].includes(row.status);
    const statusClass = failed ? 'is-error' : duplicate ? 'is-duplicate' : loading ? 'is-loading' : '';
    const statusText = ({ UPLOAD_QUEUED:'รออัปโหลด',COMPRESSING:'กำลังบีบอัด',UPLOADING:'กำลังเก็บบน NAS',AI_QUEUED:'รอ AI',AI_PROCESSING:'AI กำลังอ่าน',AI_RETRY:'ระบบจะลองใหม่',AI_FAILED:'ต้องตรวจหรือกรอกเอง',OCR_READY:'พร้อมตรวจสอบ',UPLOAD_ERROR:'อัปโหลดไม่สำเร็จ' })[row.status] || row.status;
    const warning = row.error || (row.warnings || []).join(' · ') || (duplicate ? `พบข้อมูลซ้ำ (${row.duplicate_type})` : '');
    return `<div class="receipt-edit-row" data-draft-index="${index}">
      <span class="receipt-edit-row__index">${String(index+1).padStart(2,'0')}</span>
      <button type="button" class="receipt-card-thumb" data-card-preview="${index}" aria-label="เปิดดูรูปบัตร"><span>${row.preview_url?`<img src="${escapeHtml(row.preview_url)}" alt="รูปบัตรของรายการ ${index+1}">`:'กำลังโหลดรูป'}</span><small>แตะเพื่อดูรูป</small></button>
      <label>ชื่อ-นามสกุล<input class="field" data-draft-field="full_name" value="${escapeHtml(row.full_name)}" ${loading?'disabled':''}></label>
      <label>ชื่อเล่น (ไม่บังคับ)<input class="field" data-draft-field="nickname" value="${escapeHtml(row.nickname)}" ${loading?'disabled':''}></label>
      <label>เลขบัตรประชาชน<input class="field" data-draft-field="national_id" inputmode="numeric" maxlength="17" value="${escapeHtml(row.national_id)}" ${loading?'disabled':''}></label>
      <label>ที่อยู่<textarea class="field" data-draft-field="address" ${loading?'disabled':''}>${escapeHtml(row.address)}</textarea></label>
      <label>ค่าแรง/วัน<input class="field" data-draft-field="daily_wage" inputmode="decimal" type="number" min="0" step="1" value="${Number(row.daily_wage)||0}" ${loading?'disabled':''}></label>
      <label>หมายเหตุ (ไม่บังคับ)<input class="field" data-draft-field="note" value="${escapeHtml(row.note)}" ${loading?'disabled':''}></label>
      <div class="receipt-row-state"><span class="receipt-status-pill ${statusClass}">${escapeHtml(statusText)}</span>${warning?`<small class="receipt-row-warning">${escapeHtml(warning)}</small>`:''}${duplicate?'<label class="receipt-existing-check"><input type="checkbox" data-allow-existing> เชื่อมกับบุคคลเดิมที่พบ</label>':''}${failed?`<button type="button" class="secondary-btn" data-retry-card="${index}">ลองใหม่</button>`:''}${row.registration_id?`<button type="button" class="receipt-delete-row" data-delete-card="${index}">ลบรายการ</button>`:''}</div>
    </div>`;
  }

  function renderDraftRows() { $('receipt-quick-edit-list').innerHTML = state.draftRows.map(draftRowHtml).join(''); updateBatchProgress(); hydrateCardPreviews(); }
  function renderDraftRow(index) {
    const current = document.querySelector(`[data-draft-index="${index}"]`);
    if (current) current.outerHTML = draftRowHtml(state.draftRows[index], index);
    else renderDraftRows();
    hydrateCardPreviews();
  }
  async function hydrateCardPreviews(){for(const row of state.draftRows){if(!row.registration_id||row.preview_url)continue;try{if(state.previewCache.has(row.registration_id))row.preview_url=state.previewCache.get(row.registration_id);else{const result=await gas('getReceiptCardPreview',{registration_id:row.registration_id});row.preview_url=result.data_url;state.previewCache.set(row.registration_id,row.preview_url);}const index=state.draftRows.indexOf(row),node=document.querySelector(`[data-draft-index="${index}"] .receipt-card-thumb span`);if(node)node.innerHTML=`<img src="${escapeHtml(row.preview_url)}" alt="รูปบัตรของรายการ ${index+1}">`;}catch(_){}}}
  function updateBatchProgress() {
    const ready = state.draftRows.filter(row => ['OCR_READY','AI_FAILED'].includes(row.status)).length;
    const errors = state.draftRows.filter(row => ['UPLOAD_ERROR','AI_RETRY','AI_FAILED'].includes(row.status)).length;
    const queued = state.draftRows.filter(row => ['AI_QUEUED','AI_PROCESSING'].includes(row.status)).length;
    $('receipt-batch-progress').textContent = `${ready.toLocaleString('th-TH')} พร้อมตรวจสอบ · ${queued.toLocaleString('th-TH')} รอ AI · ${errors.toLocaleString('th-TH')} รอทำต่อ · ทั้งหมด ${state.draftRows.length.toLocaleString('th-TH')}`;
    $('receipt-save-all-btn').disabled = state.processing || !ready || state.draftRows.some(row=>['UPLOAD_ERROR','AI_RETRY','AI_QUEUED','AI_PROCESSING'].includes(row.status));
    $('receipt-resume-ai-btn').classList.toggle('hidden',!state.batchId||(!queued&&!errors));
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
    const rows = state.draftRows.filter(row => ['OCR_READY','AI_FAILED'].includes(row.status)).map(row => ({
      registration_id:row.registration_id, full_name:row.full_name, national_id:row.national_id,
      address:row.address, nickname:row.nickname, daily_wage:Number(row.daily_wage)||0, note:row.note, allow_existing_worker:row.allow_existing_worker,
    }));
    if (!rows.length) return;
    $('receipt-save-all-btn').disabled = true;
    try {
      const result = await gas('saveReceiptRegistrations', { batch_id:state.batchId, rows });
      window.PayrollModule?.invalidate?.();
      await refreshRegistry();
      state.draftRows.forEach(row=>{if(row.preview_url?.startsWith('blob:'))URL.revokeObjectURL(row.preview_url);});state.draftRows = []; state.batchId=''; state.activeBatch=null;
      $('receipt-quick-edit-card').classList.add('hidden');clearSelectedFiles();
      Swal.fire({ icon:'success', title:`บันทึกแล้ว ${result.count.toLocaleString('th-TH')} คน`, text:'worker_id พร้อมเชื่อมระบบเช็กชื่อและค่าแรง', timer:2200, showConfirmButton:false });
    } catch (error) { Swal.fire('บันทึกไม่สำเร็จ',error.message,'error'); }
    finally { updateBatchProgress(); }
  }

  async function retryCard(index) {
    const row = state.draftRows[index];
    if (!row || state.processing) return;
    state.processing=true;row.error='';
    try {
      if(row.status==='UPLOAD_ERROR'&&row.file){
        row.status='COMPRESSING';renderDraftRow(index);
        const optimized=await window.ImageOptimizer.compressImage(row.file,{maxLongEdge:1600,targetBytes:750*1024,quality:.82,minQuality:.58});
        row.status='UPLOADING';renderDraftRow(index);
        const result=await protectedCallWithRequestId('queueReceiptCard',window.V2Api.newRequestId(),{batch_id:state.batchId,file_name:optimized.name,data_url:optimized.dataUrl,original_size:optimized.originalSize,optimized_size:optimized.optimizedSize});
        Object.assign(row,serverDraft(result),{file:null});
      }
      state.processing=false;
      if(row.registration_id){const result=await protectedCallWithRequestId('retryReceiptRegistration',window.V2Api.newRequestId(),{registration_id:row.registration_id});mergeBatchRows(result);}else await resumeBatchAI(true,[]);
    } catch (error) { row.status=row.registration_id?'AI_RETRY':'UPLOAD_ERROR'; row.error=error.message; }
    finally{state.processing=false;renderDraftRow(index);updateBatchProgress();}
  }

  async function deleteCard(index){const row=state.draftRows[index];if(!row?.registration_id)return;const confirm=await Swal.fire({icon:'warning',title:'ลบรายการนี้ออกจาก Quick Edit?',text:'รูปบัตรและข้อมูลที่ยังไม่บันทึกของรายการนี้จะถูกลบ',showCancelButton:true,confirmButtonText:'ลบรายการ',cancelButtonText:'กลับ',confirmButtonColor:'#b64d3e'});if(!confirm.isConfirmed)return;try{await protectedCallWithRequestId('deleteReceiptRegistration',window.V2Api.newRequestId(),{registration_id:row.registration_id});if(row.preview_url?.startsWith('blob:'))URL.revokeObjectURL(row.preview_url);state.previewCache.delete(row.registration_id);state.draftRows.splice(index,1);if(!state.draftRows.length){state.batchId='';state.activeBatch=null;$('receipt-quick-edit-card').classList.add('hidden');}renderDraftRows();}catch(error){Swal.fire('ลบรายการไม่สำเร็จ',error.message,'error');}}

  async function cancelBatch(){if(!state.batchId)return;const confirm=await Swal.fire({icon:'warning',title:'ยกเลิกชุดอัปโหลดนี้?',text:'รายการ Quick Edit และรูปบัตรในชุดที่ยังไม่บันทึกจะถูกลบทั้งหมด',showCancelButton:true,confirmButtonText:'ยกเลิกชุดงาน',cancelButtonText:'ทำงานต่อ',confirmButtonColor:'#b64d3e'});if(!confirm.isConfirmed)return;try{await protectedCallWithRequestId('cancelReceiptBatch',window.V2Api.newRequestId(),{batch_id:state.batchId});state.draftRows.forEach(row=>{if(row.preview_url?.startsWith('blob:'))URL.revokeObjectURL(row.preview_url);});state.draftRows=[];state.batchId='';state.activeBatch=null;$('receipt-quick-edit-card').classList.add('hidden');clearSelectedFiles();Swal.fire({icon:'success',title:'ยกเลิกชุดงานแล้ว',timer:1400,showConfirmButton:false});}catch(error){Swal.fire('ยกเลิกไม่สำเร็จ',error.message,'error');}}

  function showCardPreview(index){const row=state.draftRows[index];if(!row?.preview_url)return;Swal.fire({title:`รูปบัตร · รายการ ${index+1}`,imageUrl:row.preview_url,imageAlt:'รูปบัตรประชาชนสำหรับตรวจสอบ',width:720,confirmButtonText:'ปิด',confirmButtonColor:'#8f5f42',customClass:{popup:'receipt-card-preview-modal'}});}

  async function toggleReceiptItem(input){const row=state.registrations.find(item=>item.registration_id===input.dataset.receiptItemToggle);if(!row)return;input.disabled=true;const previous=Number(row.include_receipt_item)!==0,rowNode=input.closest('.receipt-registry-row');row.include_receipt_item=input.checked?1:0;rowNode?.classList.toggle('is-item-omitted',!input.checked);try{await protectedCallWithRequestId('saveReceiptExportOption',window.V2Api.newRequestId(),{registration_id:row.registration_id,receipt_item:row.receipt_item||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ',include_receipt_item:input.checked});}catch(error){row.include_receipt_item=previous?1:0;input.checked=previous;rowNode?.classList.toggle('is-item-omitted',!previous);Swal.fire('บันทึกตัวเลือกไม่สำเร็จ',error.message,'error');}finally{input.disabled=false;}}

  async function editRegistryRow(registrationId){const row=state.registrations.find(item=>item.registration_id===registrationId);if(!row)return;const result=await Swal.fire({title:'แก้ไขข้อมูลสำหรับ Export',html:`<div class="receipt-registry-editor"><label>ชื่อ-นามสกุล<input id="re-full-name" class="swal2-input" value="${escapeHtml(row.full_name||'')}"></label><label>ชื่อเล่น<input id="re-nickname" class="swal2-input" value="${escapeHtml(row.nickname||'')}"></label><label>เลขบัตรประชาชน<input id="re-national-id" class="swal2-input" inputmode="numeric" value="${escapeHtml(row.national_id||'')}"></label><label>ค่าแรง/วัน<input id="re-daily-wage" class="swal2-input" type="number" min="0" step="1" value="${Number(row.daily_wage)||0}"></label><label class="is-wide">ที่อยู่<textarea id="re-address" class="swal2-textarea">${escapeHtml(row.address||'')}</textarea></label><label class="is-wide">หมายเหตุ<input id="re-note" class="swal2-input" value="${escapeHtml(row.note||'')}"></label><label class="is-wide">ข้อความ {รายการรับเงิน}<textarea id="re-receipt-item" class="swal2-textarea">${escapeHtml(row.receipt_item||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ')}</textarea></label><label class="receipt-registry-editor__check is-wide"><input id="re-include-item" type="checkbox" ${Number(row.include_receipt_item)!==0?'checked':''}> ใส่ข้อความรายการรับเงินในเอกสาร</label></div>`,showCancelButton:true,confirmButtonText:'บันทึกการแก้ไข',cancelButtonText:'ยกเลิก',confirmButtonColor:'#8f5f42',width:720,focusConfirm:false,preConfirm:()=>({registration_id:row.registration_id,full_name:document.getElementById('re-full-name').value.trim(),nickname:document.getElementById('re-nickname').value.trim(),national_id:document.getElementById('re-national-id').value.trim(),daily_wage:Number(document.getElementById('re-daily-wage').value)||0,address:document.getElementById('re-address').value.trim(),note:document.getElementById('re-note').value.trim(),receipt_item:document.getElementById('re-receipt-item').value.trim()||'เป็นค่าจ้างแรงงานติดตั้งเครื่องมือ',include_receipt_item:document.getElementById('re-include-item').checked})});if(!result.isConfirmed)return;try{const saved=await protectedCallWithRequestId('saveReceiptRegistrationEntry',window.V2Api.newRequestId(),result.value);const index=state.registrations.findIndex(item=>item.registration_id===registrationId);if(index>=0)state.registrations[index]=saved;window.PayrollModule?.invalidate?.();renderRegistry();Swal.fire({icon:'success',title:'บันทึกการแก้ไขแล้ว',timer:1300,showConfirmButton:false});}catch(error){Swal.fire('แก้ไขข้อมูลไม่สำเร็จ',error.message,'error');}}

  async function exportSelected(format) {
    const ids = selectedRegistrationIds();
    if (!ids.length) return;
    try {
      const preview = await gas('previewReceiptExport', { registration_ids:ids });
      const groupsHtml = preview.groups.map((group,index) => `<section class="receipt-export-group"><header><span>${String(index+1).padStart(2,'0')}</span><div><strong>${escapeHtml(group.group_name)}</strong><small>${escapeHtml([group.site_code||group.site_name,group.province].filter(Boolean).join(' · ')||'ไม่ระบุไซต์')}</small></div><b>${group.people.length.toLocaleString('th-TH')} คน</b></header><div>${group.people.map(person=>`<p><span>${escapeHtml(person.full_name)}</span><small class="${person.include_receipt_item?'':'is-omitted'}">${person.include_receipt_item?escapeHtml(person.receipt_item):'ไม่ใส่ {รายการรับเงิน}'}</small></p>`).join('')}</div></section>`).join('');
      const confirm = await Swal.fire({ title:`ตรวจสอบก่อน Export ${format}`, html:`<div class="receipt-export-summary"><p>ทั้งหมด <strong>${preview.total.toLocaleString('th-TH')} คน</strong> แบ่งเป็น <strong>${preview.groups.length.toLocaleString('th-TH')} กลุ่ม</strong></p><div>${groupsHtml}</div></div>`, showCancelButton:true, confirmButtonText:`สร้าง ${format}`, cancelButtonText:'กลับไปแก้ไข', confirmButtonColor:'#8f5f42', width:680 });
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
    $('receipt-template-manage-btn').addEventListener('click',showTemplateManager);
    $('receipt-template-file').addEventListener('change',event=>renderTemplateFileState(event.target.files[0]||null,null));
    $('receipt-new-group-btn').addEventListener('click',createGroup);
    $('receipt-card-files').addEventListener('change',chooseCardFiles);
    $('receipt-upload-summary').addEventListener('click',event=>{if(event.target.closest('[data-clear-receipt-files]'))clearSelectedFiles();});
    $('receipt-process-btn').addEventListener('click',processCards);
    $('receipt-cancel-batch-btn').addEventListener('click',cancelBatch);
    $('receipt-resume-ai-btn').addEventListener('click',()=>resumeBatchAI(true));
    $('receipt-save-all-btn').addEventListener('click',saveAll);
    $('receipt-search-btn').addEventListener('click',()=>refreshRegistry().catch(error=>Swal.fire('ค้นหาไม่สำเร็จ',error.message,'error')));
    $('receipt-search').addEventListener('keydown',event=>{if(event.key==='Enter')refreshRegistry().catch(()=>{});});
    $('receipt-filter-group').addEventListener('change',event=>{if(!event.target.matches('[data-group-filter-check]'))return;const checked=[...document.querySelectorAll('[data-group-filter-check]:checked')].map(input=>input.value);state.groupFilterNone=checked.length===0;state.selectedGroupIds=new Set(checked.length===state.groups.length?[]:checked);renderGroupFilter();refreshRegistry().catch(()=>{});});
    $('receipt-filter-group').addEventListener('click',event=>{if(event.target.closest('[data-group-filter-all]')){event.preventDefault();state.groupFilterNone=false;state.selectedGroupIds.clear();renderGroupFilter();refreshRegistry().catch(()=>{});}if(event.target.closest('[data-group-filter-none]')){event.preventDefault();state.groupFilterNone=true;state.selectedGroupIds.clear();renderGroupFilter();refreshRegistry().catch(()=>{});}});
    $('receipt-select-all').addEventListener('change',event=>{document.querySelectorAll('[data-receipt-select]').forEach(input=>{input.checked=event.target.checked;});updateSelection();});
    $('receipt-registry-list').addEventListener('change',event=>{if(event.target.matches('[data-receipt-select]'))updateSelection();else if(event.target.matches('[data-receipt-item-toggle]'))toggleReceiptItem(event.target);});
    $('receipt-registry-list').addEventListener('click',event=>{const edit=event.target.closest('[data-receipt-edit]');if(edit)editRegistryRow(edit.dataset.receiptEdit);});
    $('receipt-quick-edit-list').addEventListener('click',event=>{const retry=event.target.closest('[data-retry-card]'),remove=event.target.closest('[data-delete-card]'),preview=event.target.closest('[data-card-preview]');if(retry)retryCard(Number(retry.dataset.retryCard));else if(remove)deleteCard(Number(remove.dataset.deleteCard));else if(preview)showCardPreview(Number(preview.dataset.cardPreview));});
    $('receipt-export-docx-btn').addEventListener('click',()=>exportSelected('DOCX'));
    $('receipt-export-excel-btn').addEventListener('click',()=>exportSelected('Excel'));
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded',bind) : bind();
  window.ReceiptModule = Object.freeze({ activate, refresh });
})();
