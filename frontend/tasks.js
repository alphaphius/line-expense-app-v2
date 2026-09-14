(function () {
  'use strict';

  const STORAGE_KEY = 'workhub-task-manager-approved-v1';
  const root = () => document.getElementById('task-manager-root');
  const core = () => window.WorkHubCore;
  const state = { active:'notes', data:null, selectedAsset:'asset-omnia-18', noteQuery:'', assetQuery:'', planScale:'week', showActual:true, bound:false };

  function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
  function localDateTime() { const now = new Date(); return { date:core().todayIso(), time:`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}` }; }
  function seed() {
    const today = core().todayIso();
    return {
      notes:[
        { id:'note-sensor', subject:'สรุปกำหนดติดตั้ง Sensor', people:'คุณสมชาย, ทีม Civil Work', date:core().addDays(today,-2), time:'14:30', detail:'กำหนดติดตั้ง Sensor บริเวณชั้น 2 และ 3 โดยทีม Civil Work เตรียมจุดยึดและเดินสายให้เสร็จก่อนเริ่มติดตั้ง', images:[] },
        { id:'note-zone-b', subject:'ตรวจสอบฐานราก Zone B', people:'คุณวิทยา, ทีม Survey', date:core().addDays(today,-4), time:'10:15', detail:'ตรวจระดับฐานรากและส่งผลสำรวจรอบสุดท้ายก่อนเทคอนกรีต', images:[] },
      ],
      equipmentGroups:[{id:'eqg-omnia',name:'Omnia Datalogger'},{id:'eqg-survey',name:'เครื่องมือสำรวจ'}],
      assets:[
        { id:'asset-omnia-18', serial:'OMN-240018', name:'Omnia Datalogger', groupId:'eqg-omnia', location:'ไซต์ DMR', custodian:'วรกรณ์ เติมศิริ', status:'IN_USE', note:'ใช้ตรวจวัดการสั่นสะเทือนอาคาร A', movements:[
          { id:'mv-1', location:'คลังสำนักงานใหญ่', custodian:'สมชาย วัฒนกุล', date:core().addDays(today,-45), time:'10:00', note:'ลงทะเบียนรับเข้า' },
          { id:'mv-2', location:'ไซต์งานเชียงราย', custodian:'ณัฐพงศ์ ใจดี', date:core().addDays(today,-25), time:'09:15', note:'ย้ายไปใช้งานภาคสนาม' },
          { id:'mv-3', location:'ไซต์ DMR', custodian:'วรกรณ์ เติมศิริ', date:core().addDays(today,-5), time:'16:20', note:'นำไปติดตั้งเพื่อตรวจวัดโครงสร้าง' },
        ]},
        { id:'asset-ts07', serial:'TS07-0012', name:'Total Station TS07', groupId:'eqg-survey', location:'ไซต์งานเชียงราย', custodian:'ณัฐพงศ์ ใจดี', status:'IN_USE', note:'', movements:[] },
      ],
      sites:[{id:'site-a',name:'ไซต์งาน A - อาคารสำนักงาน'},{id:'site-b',name:'ไซต์งาน B - โรงงานผลิต'},{id:'site-c',name:'ไซต์งาน C - คลังสินค้า'}],
      planTasks:[
        {id:'task-a1',siteId:'site-a',name:'งานเตรียมพื้นที่',assignee:'ณัฐพล ใจดี',planStart:core().addDays(today,-12),planEnd:core().addDays(today,-8),actualStart:core().addDays(today,-12),actualEnd:core().addDays(today,-9),progress:100,milestone:false},
        {id:'task-a2',siteId:'site-a',name:'งานฐานราก',assignee:'กฤษฎา ศรีทอง',planStart:core().addDays(today,-7),planEnd:core().addDays(today,2),actualStart:core().addDays(today,-7),actualEnd:core().addDays(today,4),progress:80,milestone:false},
        {id:'task-a3',siteId:'site-a',name:'งานโครงสร้าง',assignee:'ปิยะร ทองดี',planStart:core().addDays(today,3),planEnd:core().addDays(today,12),actualStart:core().addDays(today,5),actualEnd:core().addDays(today,15),progress:30,milestone:false},
        {id:'task-b1',siteId:'site-b',name:'งานเตรียมพื้นที่',assignee:'ชนินทร์ กุลมา',planStart:core().addDays(today,-5),planEnd:core().addDays(today,-1),actualStart:core().addDays(today,-5),actualEnd:core().addDays(today,0),progress:100,milestone:false},
        {id:'task-b2',siteId:'site-b',name:'งานติดตั้งเครื่องจักร',assignee:'ศุภสิทธิ์ สงวน',planStart:core().addDays(today,1),planEnd:core().addDays(today,13),actualStart:core().addDays(today,3),actualEnd:core().addDays(today,16),progress:10,milestone:false},
        {id:'task-b3',siteId:'site-b',name:'ทดสอบระบบ',assignee:'กิตติพงศ์ ไทยแท้',planStart:core().addDays(today,14),planEnd:core().addDays(today,14),actualStart:'',actualEnd:'',progress:0,milestone:true},
      ],
    };
  }
  function load() {
    try { state.data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || seed(); }
    catch (_) { state.data = seed(); }
    save();
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }
  function formatDate(value) { return new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric'}).format(core().parseIso(value)); }

  function shell() {
    root().innerHTML = `
      <div class="module-shell task-shell">
        <div class="module-heading">
          <div><p class="module-kicker">WORKHUB · TASK MANAGER</p><h3>ศูนย์จัดการงาน</h3><p>บันทึกสิ่งที่คุย ติดตามอุปกรณ์ และวางแผนงานในที่เดียว</p></div>
          <div class="module-save-state" id="task-save-state"><span></span>บันทึกในเครื่องแล้ว</div>
        </div>
        <nav class="module-tabs" aria-label="เมนู Task Manager">
          <button data-task-tab="notes">บันทึกการพูดคุย</button>
          <button data-task-tab="equipment">ติดตามอุปกรณ์</button>
          <button data-task-tab="plan">แผนงาน</button>
        </nav>
        <div id="task-content"></div>
        <div id="task-dialog-host"></div>
      </div>`;
    bind();
    render();
  }
  function render() {
    root().querySelectorAll('[data-task-tab]').forEach(button => button.classList.toggle('active', button.dataset.taskTab === state.active));
    if (state.active === 'notes') renderNotes();
    if (state.active === 'equipment') renderEquipment();
    if (state.active === 'plan') renderPlan();
  }

  function renderNotes() {
    const query = state.noteQuery.trim().toLowerCase();
    const rows = state.data.notes.filter(note => !query || `${note.subject} ${note.people} ${note.detail} ${note.date}`.toLowerCase().includes(query)).sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    document.getElementById('task-content').innerHTML = `
      <section class="module-panel">
        <div class="module-toolbar"><div><h4>บันทึกการพูดคุย</h4><p>ค้นย้อนหลังได้ว่าเรื่องอะไร คุยกับใคร และเมื่อไร</p></div><button class="module-primary" data-note-add>＋ เพิ่มบันทึก</button></div>
        <label class="module-search"><span aria-hidden="true">⌕</span><input data-note-search type="search" value="${esc(state.noteQuery)}" placeholder="ค้นหาว่าคุยเรื่องอะไร หรือคุยกับใคร"></label>
        <div class="note-layout">
          <div class="note-list" aria-live="polite">${rows.length ? rows.map(note => `
            <article class="note-card">
              <div class="note-card__date"><strong>${esc(note.date.slice(8))}</strong><span>${esc(new Intl.DateTimeFormat('th-TH',{month:'short'}).format(core().parseIso(note.date)))}</span></div>
              <div class="note-card__body"><h5>${esc(note.subject)}</h5><p class="note-people">คุยกับ: ${esc(note.people)}</p><p>${esc(note.detail)}</p><div class="note-meta"><span>${esc(formatDate(note.date))} · ${esc(note.time)}</span>${note.images.length ? `<span>รูปแนบ ${note.images.length}</span>`:''}</div></div>
              <div class="row-actions"><button data-note-edit="${esc(note.id)}">แก้ไข</button><button class="danger-link" data-note-delete="${esc(note.id)}">ลบ</button></div>
            </article>`).join('') : '<div class="module-empty"><strong>ไม่พบบันทึก</strong><p>ลองเปลี่ยนคำค้นหา หรือเพิ่มบันทึกการพูดคุยรายการแรก</p></div>'}</div>
          <aside class="module-tip"><span>วิธีใช้ที่แนะนำ</span><strong>จดทันทีหลังคุยจบ</strong><p>ใช้ชื่อเรื่องสั้น ๆ ระบุคนและวันเวลาให้ครบ แล้วใส่รายละเอียดที่ต้องกลับมาค้นภายหลัง</p></aside>
        </div>
      </section>`;
  }

  function noteDialog(note) {
    const now = localDateTime(); const item = note || { subject:'', people:'', date:now.date, time:now.time, detail:'', images:[] };
    showDialog(`
      <form method="dialog" data-note-form data-id="${esc(item.id || '')}" class="wh-form">
        <div class="wh-dialog__head"><div><span>บันทึกช่วยจำ</span><h4>${note?'แก้ไขบันทึก':'เพิ่มบันทึกการพูดคุย'}</h4></div><button value="cancel" aria-label="ปิด">×</button></div>
        <label>เรื่อง<input name="subject" required maxlength="160" value="${esc(item.subject)}" placeholder="เช่น สรุปกำหนดติดตั้ง Sensor"></label>
        <label>คุยกับใคร<input name="people" required maxlength="300" value="${esc(item.people)}" placeholder="ชื่อบุคคลหรือทีมที่พูดคุยด้วย"></label>
        <div class="form-grid"><label>วันที่<input name="date" type="date" required value="${esc(item.date)}"></label><label>เวลา<input name="time" type="time" required value="${esc(item.time)}"></label></div>
        <label>รายละเอียด<textarea name="detail" required rows="6" maxlength="4000" placeholder="ข้อตกลง ข้อมูลสำคัญ หรือสิ่งที่ต้องจำ">${esc(item.detail)}</textarea></label>
        <label class="file-field">รูปภาพแนบ (หลายรูปได้)<input name="images" type="file" accept="image/*" multiple><small>ภาพจะถูกย่อก่อนเก็บในเบราว์เซอร์ทดสอบ</small></label>
        ${item.images.length ? `<div class="image-strip">${item.images.map(src=>`<img src="${src}" alt="รูปแนบ">`).join('')}</div>`:''}
        <div class="wh-form__actions"><button value="cancel" class="module-secondary">ยกเลิก</button><button type="submit" class="module-primary">บันทึก</button></div>
      </form>`);
  }

  async function filesToImages(files) {
    const selected = Array.from(files || []).slice(0, 6);
    return Promise.all(selected.map(file => new Promise((resolve, reject) => {
      const image = new Image(); const reader = new FileReader();
      reader.onerror = reject; reader.onload = () => { image.src = reader.result; };
      image.onerror = reject; image.onload = () => {
        const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.width*scale)); canvas.height=Math.max(1,Math.round(image.height*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height); resolve(canvas.toDataURL('image/jpeg',.72));
      }; reader.readAsDataURL(file);
    })));
  }

  function renderEquipment() {
    const query=state.assetQuery.trim().toLowerCase();
    const assets=state.data.assets.filter(asset=>!query||`${asset.serial} ${asset.name} ${asset.location} ${asset.custodian}`.toLowerCase().includes(query));
    if (!assets.some(asset=>asset.id===state.selectedAsset)) state.selectedAsset=assets[0]?.id || '';
    const selected=state.data.assets.find(asset=>asset.id===state.selectedAsset);
    document.getElementById('task-content').innerHTML=`
      <section class="module-panel">
        <div class="module-toolbar"><div><h4>ติดตามอุปกรณ์</h4><p>ลงทะเบียนและดูประวัติว่าอุปกรณ์แต่ละชิ้นเคยอยู่ที่ใด</p></div><div class="toolbar-actions"><button class="module-secondary" data-group-manage>จัดการกลุ่ม</button><button class="module-primary" data-asset-add>＋ ลงทะเบียนของ</button></div></div>
        <label class="module-search"><span>⌕</span><input data-asset-search type="search" value="${esc(state.assetQuery)}" placeholder="ค้นหารหัส S/N ชื่อของ หรือสถานที่"></label>
        <div class="asset-layout">
          <div class="asset-list">${assets.length?assets.map(asset=>`<button class="asset-card ${asset.id===state.selectedAsset?'active':''}" data-asset-select="${esc(asset.id)}"><span class="asset-icon">▣</span><span><strong>${esc(asset.name)}</strong><small>S/N ${esc(asset.serial)}</small><small>⌖ ${esc(asset.location || 'ยังไม่ระบุ')}</small></span><em>${asset.status==='IN_USE'?'กำลังใช้งาน':'อยู่คลัง'}</em></button>`).join(''):'<div class="module-empty"><strong>ไม่พบอุปกรณ์</strong><p>ลงทะเบียนของชิ้นแรกหรือเปลี่ยนคำค้นหา</p></div>'}</div>
          ${selected?assetDetail(selected):'<div class="module-empty"><strong>เลือกอุปกรณ์</strong><p>รายละเอียดและประวัติการย้ายจะแสดงที่นี่</p></div>'}
        </div>
      </section>`;
  }
  function assetDetail(asset) {
    const group=state.data.equipmentGroups.find(item=>item.id===asset.groupId);
    const movements=[...(asset.movements||[])].sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    return `<article class="asset-detail">
      <header><div><span class="status-pill">${asset.status==='IN_USE'?'● กำลังใช้งาน':'● อยู่คลัง'}</span><h4>${esc(asset.name)}</h4><p>S/N ${esc(asset.serial)}</p></div><div class="toolbar-actions"><button class="module-primary" data-asset-move="${esc(asset.id)}">ย้ายของ</button><button class="module-secondary" data-asset-edit="${esc(asset.id)}">แก้ไข</button><button class="danger-link" data-asset-delete="${esc(asset.id)}">ลบ</button></div></header>
      <dl class="asset-facts"><div><dt>กลุ่มอุปกรณ์</dt><dd>${esc(group?.name||'-')}</dd></div><div><dt>ตำแหน่งปัจจุบัน</dt><dd>${esc(asset.location||'-')}</dd></div><div><dt>ผู้รับผิดชอบ</dt><dd>${esc(asset.custodian||'-')}</dd></div><div><dt>หมายเหตุ</dt><dd>${esc(asset.note||'-')}</dd></div></dl>
      <div class="timeline-head"><h5>ประวัติการเคลื่อนย้าย</h5><span>${movements.length} รายการ</span></div>
      <ol class="movement-timeline">${movements.length?movements.map((move,index)=>`<li class="${index===0?'current':''}"><span></span><div><strong>${esc(move.location)}</strong><small>${esc(formatDate(move.date))} · ${esc(move.time)} · ${esc(move.custodian||'ไม่ระบุผู้รับผิดชอบ')}</small><p>${esc(move.note||'ไม่มีหมายเหตุ')}</p></div></li>`).join(''):'<li class="empty"><span></span><div><strong>ยังไม่มีประวัติ</strong><p>กด “ย้ายของ” เพื่อบันทึกตำแหน่งแรก</p></div></li>'}</ol>
    </article>`;
  }
  function assetDialog(asset) {
    const item=asset||{serial:'',name:'',groupId:state.data.equipmentGroups[0]?.id||'',location:'คลังสำนักงานใหญ่',custodian:'',status:'STORED',note:''};
    showDialog(`<form method="dialog" data-asset-form data-id="${esc(item.id||'')}" class="wh-form"><div class="wh-dialog__head"><div><span>ทะเบียนอุปกรณ์</span><h4>${asset?'แก้ไขอุปกรณ์':'ลงทะเบียนของ'}</h4></div><button value="cancel">×</button></div>
      <div class="form-grid"><label>รหัสทรัพย์สิน / S/N<input name="serial" required value="${esc(item.serial)}"></label><label>ชื่ออุปกรณ์<input name="name" required value="${esc(item.name)}"></label></div>
      <label>กลุ่มอุปกรณ์<select name="groupId" required>${state.data.equipmentGroups.map(group=>`<option value="${esc(group.id)}" ${group.id===item.groupId?'selected':''}>${esc(group.name)}</option>`).join('')}</select></label>
      <div class="form-grid"><label>ตำแหน่งปัจจุบัน<input name="location" required value="${esc(item.location)}"></label><label>ผู้รับผิดชอบ<input name="custodian" value="${esc(item.custodian)}"></label></div>
      <label>สถานะ<select name="status"><option value="IN_USE" ${item.status==='IN_USE'?'selected':''}>กำลังใช้งาน</option><option value="STORED" ${item.status==='STORED'?'selected':''}>อยู่คลัง</option></select></label>
      <label>หมายเหตุ<textarea name="note" rows="3">${esc(item.note)}</textarea></label><div class="wh-form__actions"><button value="cancel" class="module-secondary">ยกเลิก</button><button type="submit" class="module-primary">บันทึก</button></div></form>`);
  }
  function movementDialog(asset) { const now=localDateTime(); showDialog(`<form method="dialog" data-movement-form data-id="${esc(asset.id)}" class="wh-form"><div class="wh-dialog__head"><div><span>${esc(asset.serial)}</span><h4>ย้าย ${esc(asset.name)}</h4></div><button value="cancel">×</button></div><label>ย้ายไปที่<input name="location" required placeholder="ชื่อไซต์หรือคลัง"></label><label>ผู้รับผิดชอบ<input name="custodian" required value="${esc(asset.custodian)}"></label><div class="form-grid"><label>วันที่<input name="date" type="date" required value="${now.date}"></label><label>เวลา<input name="time" type="time" required value="${now.time}"></label></div><label>หมายเหตุ<textarea name="note" rows="3" placeholder="เหตุผลหรือวัตถุประสงค์ในการย้าย"></textarea></label><div class="wh-form__actions"><button value="cancel" class="module-secondary">ยกเลิก</button><button type="submit" class="module-primary">ยืนยันการย้าย</button></div></form>`); }
  function groupDialog() { showDialog(`<form method="dialog" data-group-form class="wh-form"><div class="wh-dialog__head"><div><span>ตั้งค่า</span><h4>จัดการกลุ่มอุปกรณ์</h4></div><button value="cancel">×</button></div><div class="manage-list">${state.data.equipmentGroups.map(group=>`<div><span>${esc(group.name)}</span><small>${state.data.assets.filter(asset=>asset.groupId===group.id).length} ชิ้น</small><button type="button" data-group-delete="${esc(group.id)}">ลบ</button></div>`).join('')}</div><label>ชื่อกลุ่มใหม่<input name="name" placeholder="เช่น Omnia Datalogger"></label><div class="wh-form__actions"><button value="cancel" class="module-secondary">ปิด</button><button type="submit" class="module-primary">เพิ่มกลุ่ม</button></div></form>`); }

  function planRange() {
    const dates=state.data.planTasks.flatMap(task=>[task.planStart,task.planEnd,task.actualStart,task.actualEnd]).filter(Boolean).sort();
    const today=core().todayIso();
    return { start:core().addDays(dates[0]||today,-2), end:core().addDays(dates[dates.length-1]||today,5) };
  }
  function renderPlan() {
    const range=planRange(); const dayWidth=state.planScale==='month'?18:34; const days=Math.min(120,core().diffDays(range.start,range.end)+1); const width=days*dayWidth;
    const dateHeaders=Array.from({length:days},(_,i)=>{const value=core().addDays(range.start,i);const date=core().parseIso(value);return `<div style="width:${dayWidth}px" class="gantt-date ${value===core().todayIso()?'today':''}"><strong>${date.getUTCDate()}</strong><span>${new Intl.DateTimeFormat('th-TH',{month:'short'}).format(date)}</span></div>`;}).join('');
    const rows=[];
    state.data.sites.forEach(site=>{
      rows.push(`<div class="plan-site-row"><strong>⌄ ${esc(site.name)}</strong><button data-task-add="${esc(site.id)}">＋ เพิ่มงาน</button></div>`);
      state.data.planTasks.filter(task=>task.siteId===site.id).forEach(task=>rows.push(planRow(task,range.start,dayWidth,width)));
    });
    document.getElementById('task-content').innerHTML=`<section class="module-panel plan-panel"><div class="module-toolbar"><div><h4>แผนงาน</h4><p>ลากแถบเพื่อเลื่อนวัน และลากขอบเพื่อปรับระยะเวลา</p></div><div class="toolbar-actions"><button class="module-secondary" data-site-add>＋ เพิ่มไซต์งาน</button><button class="module-primary" data-task-add="${esc(state.data.sites[0]?.id||'')}">＋ เพิ่มงาน</button></div></div>
      <div class="plan-controls"><div class="plan-legend"><span class="plan-dot"></span>Plan <span class="actual-dot"></span>Actual</div><label><input type="checkbox" data-toggle-actual ${state.showActual?'checked':''}> แสดง Actual</label><div class="segmented"><button data-plan-scale="week" class="${state.planScale==='week'?'active':''}">สัปดาห์</button><button data-plan-scale="month" class="${state.planScale==='month'?'active':''}">เดือน</button></div></div>
      <div class="gantt-shell"><div class="gantt-head-left"><span>ไซต์ / งาน</span><span>ผู้รับผิดชอบ</span><span>% สำเร็จ</span></div><div class="gantt-head-scroll"><div class="gantt-dates" style="width:${width}px">${dateHeaders}</div></div><div class="gantt-body">${rows.join('')}</div></div>
      <p class="plan-mobile-hint">บนมือถือให้เลื่อน Timeline ซ้าย–ขวา และแตะชื่องานเพื่อแก้รายละเอียด</p></section>`;
  }
  function planRow(task,start,dayWidth,width) {
    const left=core().diffDays(start,task.planStart)*dayWidth, planWidth=Math.max(dayWidth, (core().diffDays(task.planStart,task.planEnd)+1)*dayWidth);
    const actualLeft=task.actualStart?core().diffDays(start,task.actualStart)*dayWidth:0, actualWidth=task.actualStart?Math.max(dayWidth,(core().diffDays(task.actualStart,task.actualEnd||task.actualStart)+1)*dayWidth):0;
    return `<div class="gantt-row" data-plan-row="${esc(task.id)}"><button class="gantt-task-name" data-task-edit="${esc(task.id)}"><strong>${esc(task.name)}</strong><small>${formatDate(task.planStart)} – ${formatDate(task.planEnd)}</small></button><span class="gantt-assignee">${esc(task.assignee||'-')}</span><span class="gantt-progress">${Number(task.progress)||0}%</span><div class="gantt-track-scroll"><div class="gantt-track" style="width:${width}px">${task.milestone?`<button class="gantt-milestone" data-task-edit="${esc(task.id)}" style="left:${left}px" title="${esc(task.name)}"></button>`:`<div class="gantt-bar plan" data-gantt-bar="${esc(task.id)}" data-kind="plan" style="left:${left}px;width:${planWidth}px"><i data-handle="start"></i><span>${esc(task.name)}</span><i data-handle="end"></i></div>`}${state.showActual&&actualWidth?`<div class="gantt-bar actual" data-gantt-bar="${esc(task.id)}" data-kind="actual" style="left:${actualLeft}px;width:${actualWidth}px"><i data-handle="start"></i><span>Actual</span><i data-handle="end"></i></div>`:''}<div class="gantt-today" style="left:${core().diffDays(start,core().todayIso())*dayWidth}px"></div></div></div></div>`;
  }
  function taskDialog(task,siteId) { const today=core().todayIso();const item=task||{siteId:siteId||state.data.sites[0]?.id,name:'',assignee:'',planStart:today,planEnd:core().addDays(today,4),actualStart:'',actualEnd:'',progress:0,milestone:false};showDialog(`<form method="dialog" data-plan-task-form data-id="${esc(item.id||'')}" class="wh-form"><div class="wh-dialog__head"><div><span>แผนงาน</span><h4>${task?'แก้ไขงาน':'เพิ่มงาน'}</h4></div><button value="cancel">×</button></div><label>ไซต์งาน<select name="siteId" required>${state.data.sites.map(site=>`<option value="${esc(site.id)}" ${site.id===item.siteId?'selected':''}>${esc(site.name)}</option>`).join('')}</select></label><label>ชื่องาน<input name="name" required value="${esc(item.name)}"></label><label>ผู้รับผิดชอบ<input name="assignee" value="${esc(item.assignee)}"></label><div class="form-grid"><label>Plan เริ่ม<input name="planStart" type="date" required value="${item.planStart}"></label><label>Plan สิ้นสุด<input name="planEnd" type="date" required value="${item.planEnd}"></label><label>Actual เริ่ม<input name="actualStart" type="date" value="${item.actualStart||''}"></label><label>Actual สิ้นสุด<input name="actualEnd" type="date" value="${item.actualEnd||''}"></label></div><label>ความคืบหน้า (%)<input name="progress" type="number" min="0" max="100" value="${Number(item.progress)||0}"></label><label class="check-row"><input name="milestone" type="checkbox" ${item.milestone?'checked':''}> เป็น Milestone</label><div class="wh-form__actions">${task?`<button type="button" class="danger-link" data-task-delete="${esc(task.id)}">ลบงาน</button>`:''}<button value="cancel" class="module-secondary">ยกเลิก</button><button type="submit" class="module-primary">บันทึกงาน</button></div></form>`);}
  function siteDialog(){showDialog(`<form method="dialog" data-site-form class="wh-form"><div class="wh-dialog__head"><div><span>แผนงาน</span><h4>เพิ่มไซต์งาน</h4></div><button value="cancel">×</button></div><label>ชื่อไซต์งาน<input name="name" required placeholder="เช่น ไซต์ DMR"></label><div class="wh-form__actions"><button value="cancel" class="module-secondary">ยกเลิก</button><button type="submit" class="module-primary">เพิ่มไซต์</button></div></form>`);}

  function showDialog(html) { const host=document.getElementById('task-dialog-host');host.innerHTML=`<dialog class="wh-dialog">${html}</dialog>`;const dialog=host.querySelector('dialog');dialog.addEventListener('close',()=>{host.innerHTML='';});dialog.showModal(); }
  function closeDialog() { document.querySelector('#task-dialog-host dialog')?.close(); }
  function notify(message) { const status=document.getElementById('task-save-state');if(!status)return;status.innerHTML=`<span></span>${esc(message)}`;status.classList.add('flash');setTimeout(()=>status.classList.remove('flash'),1000); }
  function persist(message) { save(); render(); notify(message||'บันทึกในเครื่องแล้ว'); }

  function bind() {
    if (state.bound) return; state.bound=true;
    root().addEventListener('input', event=>{if(event.target.matches('[data-note-search]')){state.noteQuery=event.target.value;renderNotes();}if(event.target.matches('[data-asset-search]')){state.assetQuery=event.target.value;renderEquipment();}});
    root().addEventListener('change',event=>{if(event.target.matches('[data-toggle-actual]')){state.showActual=event.target.checked;renderPlan();}});
    root().addEventListener('click', event=>{
      const tab=event.target.closest('[data-task-tab]');if(tab){state.active=tab.dataset.taskTab;render();return;}
      if(event.target.closest('[data-note-add]'))return noteDialog();
      const noteEdit=event.target.closest('[data-note-edit]');if(noteEdit)return noteDialog(state.data.notes.find(note=>note.id===noteEdit.dataset.noteEdit));
      const noteDelete=event.target.closest('[data-note-delete]');if(noteDelete&&confirm('ลบบันทึกนี้หรือไม่?')){state.data.notes=state.data.notes.filter(note=>note.id!==noteDelete.dataset.noteDelete);persist('ลบบันทึกแล้ว');return;}
      const assetSelect=event.target.closest('[data-asset-select]');if(assetSelect){state.selectedAsset=assetSelect.dataset.assetSelect;renderEquipment();return;}
      if(event.target.closest('[data-asset-add]'))return assetDialog();
      const assetEdit=event.target.closest('[data-asset-edit]');if(assetEdit)return assetDialog(state.data.assets.find(asset=>asset.id===assetEdit.dataset.assetEdit));
      const assetMove=event.target.closest('[data-asset-move]');if(assetMove)return movementDialog(state.data.assets.find(asset=>asset.id===assetMove.dataset.assetMove));
      const assetDelete=event.target.closest('[data-asset-delete]');if(assetDelete&&confirm('ลบอุปกรณ์และประวัติทั้งหมดหรือไม่?')){state.data.assets=state.data.assets.filter(asset=>asset.id!==assetDelete.dataset.assetDelete);persist('ลบอุปกรณ์แล้ว');return;}
      if(event.target.closest('[data-group-manage]'))return groupDialog();
      const groupDelete=event.target.closest('[data-group-delete]');if(groupDelete){const used=state.data.assets.some(asset=>asset.groupId===groupDelete.dataset.groupDelete);if(used)return alert('ลบกลุ่มไม่ได้ เพราะยังมีอุปกรณ์อยู่ในกลุ่ม');state.data.equipmentGroups=state.data.equipmentGroups.filter(group=>group.id!==groupDelete.dataset.groupDelete);closeDialog();persist('ลบกลุ่มแล้ว');return;}
      if(event.target.closest('[data-site-add]'))return siteDialog();
      const addTask=event.target.closest('[data-task-add]');if(addTask)return taskDialog(null,addTask.dataset.taskAdd);
      const editTask=event.target.closest('[data-task-edit]');if(editTask)return taskDialog(state.data.planTasks.find(task=>task.id===editTask.dataset.taskEdit));
      const deleteTask=event.target.closest('[data-task-delete]');if(deleteTask&&confirm('ลบงานนี้หรือไม่?')){state.data.planTasks=state.data.planTasks.filter(task=>task.id!==deleteTask.dataset.taskDelete);closeDialog();persist('ลบงานแล้ว');return;}
      const scale=event.target.closest('[data-plan-scale]');if(scale){state.planScale=scale.dataset.planScale;renderPlan();}
    });
    root().addEventListener('submit', async event=>{
      event.preventDefault(); const form=event.target; const values=Object.fromEntries(new FormData(form));
      if(form.matches('[data-note-form]')){const existing=state.data.notes.find(note=>note.id===form.dataset.id);const images=await filesToImages(form.elements.images.files);const item={id:existing?.id||id('note'),subject:values.subject.trim(),people:values.people.trim(),date:values.date,time:values.time,detail:values.detail.trim(),images:images.length?images:(existing?.images||[])};state.data.notes=existing?state.data.notes.map(note=>note.id===item.id?item:note):[item,...state.data.notes];closeDialog();persist('บันทึกการพูดคุยแล้ว');}
      if(form.matches('[data-asset-form]')){const serial=values.serial.trim();const duplicate=state.data.assets.find(asset=>asset.serial.toLowerCase()===serial.toLowerCase()&&asset.id!==form.dataset.id);if(duplicate)return alert(`S/N ${serial} ถูกลงทะเบียนแล้ว`);const existing=state.data.assets.find(asset=>asset.id===form.dataset.id);const item={...(existing||{}),id:existing?.id||id('asset'),serial,name:values.name.trim(),groupId:values.groupId,location:values.location.trim(),custodian:values.custodian.trim(),status:values.status,note:values.note.trim(),movements:existing?.movements||[]};if(!existing)item.movements=[{id:id('mv'),location:item.location,custodian:item.custodian,date:core().todayIso(),time:localDateTime().time,note:'ลงทะเบียนอุปกรณ์'}];state.data.assets=existing?state.data.assets.map(asset=>asset.id===item.id?item:asset):[item,...state.data.assets];state.selectedAsset=item.id;closeDialog();persist('บันทึกอุปกรณ์แล้ว');}
      if(form.matches('[data-movement-form]')){const asset=state.data.assets.find(item=>item.id===form.dataset.id);asset.location=values.location.trim();asset.custodian=values.custodian.trim();asset.status=/คลัง/.test(asset.location)?'STORED':'IN_USE';asset.movements.push({id:id('mv'),location:asset.location,custodian:asset.custodian,date:values.date,time:values.time,note:values.note.trim()});closeDialog();persist('บันทึกการย้ายแล้ว');}
      if(form.matches('[data-group-form]')){const name=values.name.trim();if(state.data.equipmentGroups.some(group=>group.name.toLowerCase()===name.toLowerCase()))return alert('มีกลุ่มชื่อนี้แล้ว');state.data.equipmentGroups.push({id:id('eqg'),name});closeDialog();persist('เพิ่มกลุ่มอุปกรณ์แล้ว');}
      if(form.matches('[data-site-form]')){state.data.sites.push({id:id('site'),name:values.name.trim()});closeDialog();persist('เพิ่มไซต์งานแล้ว');}
      if(form.matches('[data-plan-task-form]')){if(values.planEnd<values.planStart)return alert('วันสิ้นสุด Plan ต้องไม่ก่อนวันเริ่ม');if(values.actualStart&&values.actualEnd&&values.actualEnd<values.actualStart)return alert('วันสิ้นสุด Actual ต้องไม่ก่อนวันเริ่ม');const existing=state.data.planTasks.find(task=>task.id===form.dataset.id);const item={id:existing?.id||id('task'),siteId:values.siteId,name:values.name.trim(),assignee:values.assignee.trim(),planStart:values.planStart,planEnd:values.planEnd,actualStart:values.actualStart||'',actualEnd:values.actualEnd||'',progress:core().clamp(values.progress,0,100),milestone:form.elements.milestone.checked};state.data.planTasks=existing?state.data.planTasks.map(task=>task.id===item.id?item:task):[...state.data.planTasks,item];closeDialog();persist('บันทึกแผนงานแล้ว');}
    });
    root().addEventListener('pointerdown', startDrag);
  }
  function startDrag(event) {
    const bar=event.target.closest('[data-gantt-bar]');if(!bar||event.button!==0)return;
    event.preventDefault();const task=state.data.planTasks.find(item=>item.id===bar.dataset.ganttBar);if(!task)return;
    const dayWidth=state.planScale==='month'?18:34;const kind=bar.dataset.kind;const handle=event.target.closest('[data-handle]')?.dataset.handle||'move';const startX=event.clientX;const original={start:task[`${kind}Start`],end:task[`${kind}End`]};
    bar.setPointerCapture(event.pointerId);bar.classList.add('dragging');
    const move=moveEvent=>{const days=Math.round((moveEvent.clientX-startX)/dayWidth);bar.style.transform=`translateX(${days*dayWidth}px)`;};
    const up=upEvent=>{bar.removeEventListener('pointermove',move);bar.removeEventListener('pointerup',up);const days=Math.round((upEvent.clientX-startX)/dayWidth);bar.classList.remove('dragging');if(!days)return renderPlan();if(handle==='move'){task[`${kind}Start`]=core().addDays(original.start,days);task[`${kind}End`]=core().addDays(original.end,days);}else if(handle==='start'){const candidate=core().addDays(original.start,days);task[`${kind}Start`]=candidate<=original.end?candidate:original.end;}else{const candidate=core().addDays(original.end,days);task[`${kind}End`]=candidate>=original.start?candidate:original.start;}persist('ปรับ Timeline แล้ว');};
    bar.addEventListener('pointermove',move);bar.addEventListener('pointerup',up);
  }

  function activate(force) { if (!state.data||force) load(); if (!root().querySelector('.module-shell')||force) shell(); else render(); }
  window.TaskManagerModule=Object.freeze({activate,resetLocal:()=>{localStorage.removeItem(STORAGE_KEY);state.data=null;activate(true);}});
})();
