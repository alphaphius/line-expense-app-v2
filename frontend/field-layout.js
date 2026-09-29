(function () {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function bindSort(parent,{itemSelector,handleSelector,onCommit}) {
    if(!parent)return;
    parent.querySelectorAll(handleSelector).forEach(handle=>{
      handle.draggable=false;handle.style.touchAction='none';
      handle.onpointerdown=event=>{
        if(event.button!==0||parent.dataset.sorting)return;
        const item=handle.closest(itemSelector);if(!item)return;
        event.preventDefault();event.stopPropagation();
        const original=[...parent.querySelectorAll(itemSelector)],from=original.indexOf(item),bounds=item.getBoundingClientRect(),ghost=item.cloneNode(true),layer=parent.closest('dialog')||document.body;
        const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
        let x=event.clientX,y=event.clientY,lastX=x,lastY=y,active=true,frame,lastMove=0;
        ghost.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));ghost.removeAttribute('id');ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.classList.add('field-sort-ghost');
        Object.assign(ghost.style,{position:'fixed',left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:bounds.height+'px',margin:'0',gridColumn:'auto',pointerEvents:'none',zIndex:'2147483647'});layer.append(ghost);
        item.classList.add('field-sort-placeholder');parent.dataset.sorting='true';handle.setAttribute('aria-grabbed','true');
        let scroller=parent;while(scroller!==document.body&&!(scroller.scrollHeight>scroller.clientHeight&&/auto|scroll/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;
        function preview(){
          if(!active)return;
          ghost.style.transform=`translate(${x-event.clientX}px,${y-event.clientY}px)`;
          const viewport=scroller.getBoundingClientRect();if(y<viewport.top+36)scroller.scrollTop-=12;else if(y>viewport.bottom-36)scroller.scrollTop+=12;
          if(Math.hypot(x-lastX,y-lastY)>7&&performance.now()-lastMove>90){
            const target=document.elementFromPoint(x,y)?.closest(itemSelector);
            if(target&&target!==item&&target.parentElement===item.parentElement){
              const nodes=[...parent.querySelectorAll(itemSelector)],before=new Map(nodes.map(node=>[node,node.getBoundingClientRect()])),a=nodes.indexOf(item),b=nodes.indexOf(target);
              nodes.forEach(node=>node.getAnimations().forEach(animation=>animation.cancel()));
              target.parentElement.insertBefore(item,a<b?target.nextSibling:target);
              if(!reduced)nodes.forEach(node=>{const old=before.get(node),now=node.getBoundingClientRect();node.animate([{transform:`translate(${old.left-now.left}px,${old.top-now.top}px)`},{transform:'translate(0,0)'}],{duration:180,easing:'cubic-bezier(.16,1,.3,1)'});});
              lastMove=performance.now();lastX=x;lastY=y;
            }
          }
          frame=requestAnimationFrame(preview);
        }
        function finish(commit){
          if(!active)return;active=false;cancelAnimationFrame(frame);document.removeEventListener('pointermove',moving);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);document.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);layer.removeEventListener('close',cancel);
          const order=[...parent.querySelectorAll(itemSelector)],to=order.indexOf(item);ghost.remove();item.classList.remove('field-sort-placeholder');delete parent.dataset.sorting;handle.removeAttribute('aria-grabbed');original.forEach(node=>node.getAnimations().forEach(animation=>animation.cancel()));
          if(!commit)original.forEach(node=>item.parentElement.append(node));else if(from!==to)onCommit(from,to,order);
        }
        const moving=e=>{if(e.pointerId!==event.pointerId)return;e.preventDefault();x=e.clientX;y=e.clientY;},up=e=>{if(e.pointerId===event.pointerId)finish(true);},cancel=()=>finish(false),key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(false);}};
        document.addEventListener('pointermove',moving,{passive:false});document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);document.addEventListener('keydown',key);window.addEventListener('blur',cancel);layer.addEventListener('close',cancel,{once:true});frame=requestAnimationFrame(preview);
      };
    });
  }
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
      bindSort(host.querySelector('.field-layout-preview'),{itemSelector:'[data-layout-key]',handleSelector:'[data-layout-drag]',onCommit:(_,__,tiles)=>{const next=settings(schema,device),keys=tiles.map(tile=>tile.dataset.layoutKey),visible=new Set(keys);let index=0;next.order=next.order.map(key=>visible.has(key)?keys[index++]:key);update(next);render();}});
      /* Native drag events remain supported for automation and non-pointer clients. */
      host.querySelectorAll('[data-layout-drag]').forEach(handle=>{
        handle.ondragstart=e=>{e.stopPropagation();drag=handle.dataset.layoutDrag;e.dataTransfer.setData('text/plain',drag);e.dataTransfer.effectAllowed='move';};
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
  window.WorkHubFieldLayout=Object.freeze({mount,apply,settings,bindSort});
})();
