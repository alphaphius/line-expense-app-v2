(function () {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function settings(schema,device) {
    const layout=schema.layout?.[device]||{},keys=schema.fields.map(field=>field.key),columns=Math.max(1,Math.min(device==='mobile'?3:4,Number(layout.columns)||(device==='mobile'?1:2)));
    return {columns,order:[...new Set([...(layout.order||[]).filter(key=>keys.includes(key)),...keys])],spans:{...layout.spans}};
  }
  function mount(container,schema) {
    if(!schema||container.querySelector('.field-layout-editor'))return;
    const manager=container.querySelector('.template-page-manager');if(!manager)return;
    const host=document.createElement('section');host.className='field-layout-editor';manager.after(host);
    let device='desktop',page=1,drag=null;
    const update=layout=>{schema.layout={...schema.layout,[device]:layout};};
    function move(key,target) {const layout=settings(schema,device),from=layout.order.indexOf(key),to=layout.order.indexOf(target);if(from<0||to<0||from===to)return;layout.order.splice(from,1);layout.order.splice(to,0,key);update(layout);render();}
    function render() {
      const layout=settings(schema,device),fields=layout.order.map(key=>schema.fields.find(field=>field.key===key)).filter(field=>Number(field.page||1)===page);
      host.innerHTML=`<header><div><strong>จัดวางช่องกรอกข้อมูล</strong><p>ตั้งค่าแยกตามหน้าจอ · ลากที่ปุ่มย้าย หรือใช้ลูกศร · บันทึกพร้อมการตั้งค่า Field</p></div><div class="field-layout-devices">${[['desktop','คอมพิวเตอร์'],['mobile','โทรศัพท์']].map(([value,label])=>`<button type="button" data-layout-device="${value}" class="${device===value?'active':''}" aria-pressed="${device===value}">${label}</button>`).join('')}</div></header><div class="field-layout-tools"><label>หน้าฟอร์ม<select data-layout-page>${schema.pages.map(p=>`<option value="${p.number}" ${p.number===page?'selected':''}>${esc(p.title)}</option>`).join('')}</select></label><label>จำนวนคอลัมน์<select data-layout-columns>${Array.from({length:device==='mobile'?3:4},(_,i)=>`<option value="${i+1}" ${i+1===layout.columns?'selected':''}>${i+1} คอลัมน์</option>`).join('')}</select></label></div><div class="field-layout-preview ${device==='mobile'?'is-mobile':''}" style="--layout-columns:${layout.columns}">${fields.map((field,index)=>`<div class="field-layout-tile" data-layout-key="${esc(field.key)}" style="grid-column:span ${Math.min(layout.columns,Math.max(1,Number(layout.spans[field.key])||1))}"><div class="field-layout-tile-head"><button type="button" draggable="false" data-layout-drag="${esc(field.key)}" aria-label="ลากย้าย ${esc(field.label)}">⋮⋮</button><strong>${esc(field.label)}</strong></div><small>${esc(field.type)} · {${esc(field.key)}}</small><div class="field-layout-tile-tools"><label>กินพื้นที่<select data-layout-span="${esc(field.key)}" aria-label="ความกว้าง ${esc(field.label)}">${Array.from({length:layout.columns},(_,i)=>`<option value="${i+1}" ${i+1===Math.min(layout.columns,Number(layout.spans[field.key])||1)?'selected':''} >${i+1} ช่อง</option>`).join('')}</select></label><button type="button" data-layout-up="${esc(field.key)}" ${index===0?'disabled':''} aria-label="ย้าย ${esc(field.label)} ขึ้น">↑</button><button type="button" data-layout-down="${esc(field.key)}" ${index===fields.length-1?'disabled':''} aria-label="ย้าย ${esc(field.label)} ลง">↓</button></div></div>`).join('')||'<p>หน้านี้ยังไม่มี Field</p>'}</div>`;
      host.querySelectorAll('[data-layout-device]').forEach(b=>b.onclick=e=>{e.stopPropagation();device=b.dataset.layoutDevice;render();});
      host.querySelector('[data-layout-page]').onchange=e=>{e.stopPropagation();page=Number(e.target.value);render();};
      host.querySelector('[data-layout-columns]').onchange=e=>{e.stopPropagation();layout.columns=Number(e.target.value);update(layout);render();};
      host.querySelectorAll('[data-layout-span]').forEach(select=>select.onchange=e=>{e.stopPropagation();layout.spans[select.dataset.layoutSpan]=Number(select.value);update(layout);render();});
      host.querySelectorAll('[data-layout-up],[data-layout-down]').forEach(b=>b.onclick=e=>{e.stopPropagation();const key=b.dataset.layoutUp||b.dataset.layoutDown,index=fields.findIndex(field=>field.key===key);move(key,fields[index+(b.hasAttribute('data-layout-up')?-1:1)]?.key);});
      host.querySelectorAll('[data-layout-drag]').forEach(handle=>{
        handle.ondragstart=e=>{e.stopPropagation();drag=handle.dataset.layoutDrag;e.dataTransfer.setData('text/plain',drag);e.dataTransfer.effectAllowed='move';};
        handle.onpointerdown=e=>{e.preventDefault();e.stopPropagation();drag=handle.dataset.layoutDrag;handle.closest('[data-layout-key]').classList.add('is-dragging');handle.setPointerCapture(e.pointerId);};
        handle.onpointermove=e=>{if(!drag)return;e.preventDefault();host.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-layout-key]')?.classList.add('is-drop-target');};
        handle.onpointerup=e=>{if(!drag)return;const key=drag;drag=null;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-layout-key]');host.querySelectorAll('.is-dragging,.is-drop-target').forEach(n=>n.classList.remove('is-dragging','is-drop-target'));if(target&&host.contains(target))move(key,target.dataset.layoutKey);};
        handle.onpointercancel=()=>{drag=null;host.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));};
      });
      host.querySelectorAll('[data-layout-key]').forEach(tile=>{tile.ondragover=e=>{if(!drag)return;e.preventDefault();e.stopPropagation();};tile.ondrop=e=>{if(!drag)return;e.preventDefault();e.stopPropagation();const key=drag;drag=null;move(key,tile.dataset.layoutKey);};});
    }
    host.addEventListener('dragend',()=>drag=null);render();
  }
  function apply(root,schema) {
    if(!schema?.layout||!root)return;
    const desktop=settings(schema,'desktop'),mobile=settings(schema,'mobile');
    root.querySelectorAll('.report-field-list,.reading-entry-grid').forEach(grid=>{
      grid.classList.add('responsive-field-layout');grid.style.setProperty('--field-desktop-columns',desktop.columns);grid.style.setProperty('--field-mobile-columns',mobile.columns);
      for(const child of grid.children){const control=child.querySelector('[name],[data-report-image],[data-formula-output]'),key=control?.name||control?.dataset.reportImage||control?.dataset.formulaOutput;if(!key)continue;child.style.setProperty('--field-desktop-order',Math.max(0,desktop.order.indexOf(key)));child.style.setProperty('--field-mobile-order',Math.max(0,mobile.order.indexOf(key)));child.style.setProperty('--field-desktop-span',Math.min(desktop.columns,Math.max(1,Number(desktop.spans[key])||1)));child.style.setProperty('--field-mobile-span',Math.min(mobile.columns,Math.max(1,Number(mobile.spans[key])||1)));}
    });
  }
  window.WorkHubFieldLayout=Object.freeze({mount,apply,settings});
})();
