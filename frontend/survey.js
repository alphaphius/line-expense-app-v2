(function () {
  'use strict';
  const core=()=>window.WorkHubSurveyCore;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=()=>`sv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const rounded=(value,digits=3)=>Number.isFinite(Number(value))&&value!==''&&value!=null?Number(value).toFixed(digits):'—';
  const button=(action,label,primary=false)=>`<button type="button" class="${primary?'module-primary':'module-secondary'}" data-sv="${action}">${label}</button>`;
  const symbol=index=>{const star=index>=7,sides=star?index-3:index+3,count=star?sides*2:sides;return Array.from({length:count},(_,i)=>{const angle=-Math.PI/2+i*Math.PI*2/count,radius=star&&i%2?5:10;return `${i?'L':'M'}${Math.cos(angle)*radius},${Math.sin(angle)*radius}`;}).join(' ')+' Z';};
  const input=(name,label,value='',extra='')=>`<label>${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
  function download(name,text){const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function mount(host,options) {
    const {site,types,save,loadMaps,parseCsv,storeImage,getImage,deleteImage,authorizeDelete}=options;
    const data=site.survey||(site.survey={references:[],draft:[],plans:[],actuals:{},alignment:{first:'',second:'',leftSide:'U'}});
    let tab='references',map=null,mapSerial=0,zone,error='';
    try {zone=core().zoneForSite(site);} catch(e){error=e.message;}
    const refs=()=>data.references;
    const line=()=>core().alignment(refs().find(p=>p.id===data.alignment.first),refs().find(p=>p.id===data.alignment.second),zone);
    const persist=()=>{data.updatedAt=new Date().toISOString();save();};
    const coordinateButtons=p=>`<div class="survey-coordinates">${[['N',p.northing,3],['E',p.easting,3],['Lat',p.latitude,7],['Long',p.longitude,7]].map(([label,value,digits])=>`<button type="button" data-copy="${esc(rounded(value,digits))}" title="คัดลอก ${label}"><span>${label}</span> ${rounded(value,digits)}</button>`).join('')}</div>`;
    function dialog(title,body,onSubmit) {
      const node=document.createElement('dialog');node.className='wh-dialog survey-dialog';
      node.innerHTML=`<form class="wh-form"><header class="wh-dialog__head"><h4>${esc(title)}</h4><button type="button" data-close aria-label="ปิด">×</button></header><div class="survey-dialog-body">${body}<p class="survey-error" role="alert"></p></div><footer class="wh-form__actions"><button type="button" data-close class="module-secondary">ยกเลิก</button>${onSubmit?'<button type="submit" class="module-primary">บันทึก</button>':''}</footer></form>`;
      document.body.append(node);node.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>node.close());
      node.addEventListener('close',()=>node.remove());
      node.querySelector('form').onsubmit=async e=>{e.preventDefault();e.stopPropagation();const submit=e.submitter;if(submit)submit.disabled=true;try{await onSubmit(Object.fromEntries(new FormData(e.target)),e.target);node.close();render();}catch(err){node.querySelector('.survey-error').textContent=err.message;}finally{if(submit)submit.disabled=false;}};
      node.showModal();return node;
    }
    function coordinateForm(point) {
      return `<fieldset class="survey-fieldset"><legend>Coordinate · WGS84 / UTM ${zone}N</legend><div class="survey-coord-editor">${input('latitude','Latitude',point.latitude==null?'':rounded(point.latitude,8),'type="number" step="any"')}${input('longitude','Longitude',point.longitude==null?'':rounded(point.longitude,8),'type="number" step="any"')}${button('convert-latlong','Lat / Long → N / E')}${input('northing','UTM N (m)',point.northing==null?'':rounded(point.northing),'type="number" step="any"')}${input('easting','UTM E (m)',point.easting==null?'':rounded(point.easting),'type="number" step="any"')}${button('convert-utm','N / E → Lat / Long')}${input('elevation','Elevation (m)',point.elevation??'','type="number" step="any"')}</div><p class="form-note">แก้พิกัดชุดใดแล้วกด Convert เพื่อแปลงอีกชุด · Zone อ้างอิง Longitude ของไซต์</p></fieldset>`;
    }
    function alignmentFields(point) {
      return `<div class="survey-fields">${input('sta','STA (เช่น 1+250)',point.sta??'','required')}${input('offset','Offset (m)',point.offset??0,'type="number" min="0" step="any" required')}<label>ฝั่ง<select name="side">${[['CL','CL · กลางสันเขื่อน'],['U','U/S · ฝั่งอ่างเก็บน้ำ'],['D','D/S · ท้ายน้ำ']].map(([value,label])=>`<option value="${value}" ${point.side===value?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
    }
    function wireCoordinates(node,initial) {
      let source='latlong';
      const form=node.querySelector('form');
      form.addEventListener('input',e=>{if(['northing','easting'].includes(e.target.name))source='utm';if(['latitude','longitude'].includes(e.target.name))source='latlong';});
      const convert=()=>{
        const values=Object.fromEntries(new FormData(form)),point=core().convert(values,source,zone);
        ['latitude','longitude','northing','easting'].forEach(key=>form.elements[key].value=rounded(point[key],key==='latitude'||key==='longitude'?8:3));
        return point;
      };
      node.querySelectorAll('[data-sv^="convert-"]').forEach(b=>b.onclick=()=>{try{source=b.dataset.sv==='convert-utm'?'utm':'latlong';convert();node.querySelector('.survey-error').textContent='';}catch(e){node.querySelector('.survey-error').textContent=e.message;}});
      return convert;
    }
    function validateAlignment(values) {
      const sta=core().stationText(values.sta),offset=Number(values.offset);
      if(values.offset===''||values.offset==null||!Number.isFinite(offset)||offset<0)throw new Error('Offset ต้องเป็นตัวเลขไม่ติดลบ');
      if(values.side==='CL'&&offset!==0)throw new Error('CL ต้องมี Offset เท่ากับ 0');
      return {sta,offset,side:values.side};
    }
    function referenceEditor(refId) {
      const existing=refs().find(p=>p.id===refId),point=existing||{id:id(),side:'CL'},photos=[...(point.photos||[])];let convert;
      const node=dialog(existing?'แก้ไขตำแหน่งอ้างอิง':'เพิ่มตำแหน่งอ้างอิง',`${input('name','ชื่อหมุด',point.name,'required maxlength="100"')}${coordinateForm(point)}<fieldset class="survey-fieldset"><legend>Survey Alignment</legend>${alignmentFields(point)}${input('note','Note',point.note)}</fieldset><div class="survey-fields"><label>Control Flags<select name="flag">${['Static Ref.','CORS Base','RTK Base'].map(flag=>`<option ${point.flag===flag?'selected':''}>${flag}</option>`).join('')}</select></label><label>รูปภาพ · เลือกได้หลายรูป<input type="file" name="photos" accept="image/*" multiple><small data-file-status>ยังไม่ได้เลือกไฟล์ใหม่</small></label></div><div class="survey-photo-list">${photos.map(photo=>`<button type="button" data-ref-photo="${esc(photo.id)}">ดูรูป</button>`).join('')}</div>`,async(values,form)=>{
        if(refs().some(p=>p.id!==point.id&&p.name.toLowerCase()===values.name.trim().toLowerCase()))throw new Error('ชื่อหมุดนี้มีอยู่แล้ว');
        const coords=convert(),alignment=validateAlignment(values),newPoint={...point,...coords,...alignment,name:values.name.trim(),flag:values.flag,note:values.note,elevation:values.elevation===''?null:Number(values.elevation),photos};
        // File bytes are stored separately from shared survey metadata.
        for(const file of form.elements.photos.files){if(!file.type.startsWith('image/'))throw new Error('รองรับเฉพาะรูปภาพ');const image=await window.ImageOptimizer.compressImage(file,{maxLongEdge:2000,targetBytes:600*1024,quality:.82}),photoId=id();await storeImage(photoId,image);photos.push({id:photoId});}
        if(existing)Object.assign(existing,newPoint);else refs().push(newPoint);
        if(data.plans.length)data.planStale=true;
        persist();
      });
      convert=wireCoordinates(node,point);
      node.querySelector('[name="photos"]').onchange=e=>node.querySelector('[data-file-status]').textContent=Array.from(e.target.files).map(f=>f.name).join(', ')||'ยังไม่ได้เลือกไฟล์ใหม่';
      node.querySelectorAll('[data-ref-photo]').forEach(b=>b.onclick=()=>viewPhoto(b.dataset.refPhoto));
    }
    async function viewPhoto(photoId) {
      try{const photo=await getImage(photoId);if(!photo?.dataUrl)throw new Error('โหลดรูปไม่ได้ กรุณาลองอีกครั้ง');const node=dialog('รูปหมุดอ้างอิง',`<img class="survey-photo-large" src="${esc(photo.dataUrl)}" alt="รูปหมุดอ้างอิง">${button('delete-photo','ลบรูปนี้')}`);
        node.querySelector('[data-sv="delete-photo"]').onclick=async()=>{if(!await authorizeDelete('ลบรูปหมุดอ้างอิง','รูปนี้จะถูกลบจากตำแหน่งอ้างอิง'))return;try{await deleteImage(photoId);refs().forEach(ref=>ref.photos=(ref.photos||[]).filter(p=>p.id!==photoId));persist();node.close();render();}catch(e){node.querySelector('.survey-error').textContent=e.message;}};
      }catch(e){showError(e);}
    }
    function draftEditor(index) {
      const row=data.draft[index]||{instrumentId:options.instrument?.id||'',type:options.instrument?.type||types[0],side:'U',offset:0};
      dialog(index==null?'เพิ่ม Instrument ในแผน':'แก้ไข Instrument ในแผน',`<div class="survey-fields">${input('instrumentId','Instrument ID',row.instrumentId,'required')}<label>Instrument Type<select name="type">${types.map(t=>`<option ${row.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label></div>${alignmentFields(row)}`,values=>{const result={...values,...validateAlignment(values)};if(data.draft.some((r,i)=>i!==index&&r.instrumentId.toLowerCase()===result.instrumentId.trim().toLowerCase()))throw new Error('Instrument ID ซ้ำในแผน');result.instrumentId=result.instrumentId.trim();if(index==null)data.draft.push(result);else data.draft[index]=result;data.planStale=!!data.plans.length;persist();});
    }
    function actualEditor(instrumentId) {
      const plan=data.plans.find(p=>p.instrumentId===instrumentId),point=data.actuals[instrumentId]||plan;let convert;
      const node=dialog(`ตำแหน่งติดตั้งจริง · ${instrumentId}`,`<p class="form-note">ตามแผน: STA ${esc(plan.sta)} · Offset ${plan.offset} m · ${esc(plan.side)}</p>${coordinateForm(point)}${alignmentFields(point)}${input('note','หมายเหตุ',point.note||'')}`,values=>{
        const actual={...convert(),...validateAlignment(values),elevation:values.elevation===''?null:Number(values.elevation),note:values.note,updatedAt:new Date().toISOString()};
        data.actuals[instrumentId]=actual;persist();
      });convert=wireCoordinates(node,point);
      const warning=document.createElement('p');warning.className='survey-warning';node.querySelector('.survey-dialog-body').append(warning);
      node.querySelector('form').addEventListener('input',()=>{try{const actual=Object.fromEntries(new FormData(node.querySelector('form')));warning.textContent=core().changes(plan,actual).changed?'ตำแหน่ง STA / Offset / ฝั่งเปลี่ยนจากแผน':'';}catch(_){warning.textContent='';}});
    }
    function refOptions(value){return `<option value="">เลือกหมุดอ้างอิง</option>${refs().map(ref=>`<option value="${esc(ref.id)}" ${ref.id===value?'selected':''}>${esc(ref.name)} · STA ${esc(ref.sta)}</option>`).join('')}`;}
    function refSummary(refId){const p=refs().find(r=>r.id===refId);return p?`<small>STA ${esc(p.sta)}</small>${coordinateButtons(p)}`:'<small>ยังไม่ได้เลือก</small>';}
    function table(headers,rows){return `<div class="survey-table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>{let index=0;return row.replace(/<td>/g,()=>`<td data-label="${esc(headers[index++])}">`);}).join('')||`<tr><td colspan="${headers.length}">ยังไม่มีข้อมูล</td></tr>`}</tbody></table></div>`;}
    function render() {
      if(!host.isConnected)return;
      let summary='';try{const a=line();summary=`ระยะในระนาบ UTM ${rounded(a.distance)} m · ช่วง STA ${rounded(a.stationSpan)} m · ต่างกัน ${rounded(a.distance-a.stationSpan)} m`;}catch(_){}
      host.innerHTML=`<section class="survey-panel"><header class="survey-heading"><div><h4>Survey · ${esc(site.id)}</h4><p>${zone?`WGS84 · UTM ${zone}N`:'ตั้งค่าพิกัดไซต์ก่อนเริ่ม Survey'} · ข้อมูลใช้ร่วมกันภายในไซต์</p></div></header><nav class="survey-tabs">${[['references','ตำแหน่งอ้างอิง'],['plan','แผนการสำรวจ'],['actual','ตำแหน่งติดตั้งจริง']].map(([key,label])=>`<button type="button" data-tab="${key}" class="${tab===key?'active':''}" aria-pressed="${tab===key}">${label}</button>`).join('')}</nav><p class="survey-error" role="alert">${esc(error)}</p>${!zone?'':`<div class="survey-workspace"><div class="survey-main">${tab==='references'?`${button('add-ref','เพิ่มหมุดอ้างอิง',true)}${table(['ชื่อหมุด / ประเภท','Coordinate · กดเพื่อคัดลอก','STA / Offset','จัดการ'],refs().map(p=>`<tr><td><strong>${esc(p.name)}</strong><small>${esc(p.flag)}</small>${p.photos?.length?`<button type="button" data-photo-list="${esc(p.id)}">รูปภาพ ${p.photos.length}</button>`:''}</td><td>${coordinateButtons(p)}<small>Elevation ${rounded(p.elevation)} m</small></td><td>${esc(p.sta)} · ${rounded(p.offset)} m ${esc(p.side)}<small>${esc(p.note)}</small></td><td><div class="survey-row-actions"><button type="button" data-edit-ref="${esc(p.id)}">แก้ไข</button><button type="button" data-delete-ref="${esc(p.id)}">ลบ</button></div></td></tr>`))}`:tab==='plan'?`<div class="survey-ref-select"><label>Ref point 1<select data-ref="first">${refOptions(data.alignment.first)}</select>${refSummary(data.alignment.first)}</label><label>Ref point 2<select data-ref="second">${refOptions(data.alignment.second)}</select>${refSummary(data.alignment.second)}</label></div><div class="survey-toolbar">${button('line','สร้างเส้น')}<span>${esc(summary)}</span></div><p class="form-note">มองไปทาง STA มากขึ้น · ซ้ายมือเป็น</p><div class="survey-side-buttons">${['U','D'].map(v=>`<button type="button" data-left="${v}" class="${data.alignment.leftSide===v?'active':''}" aria-pressed="${data.alignment.leftSide===v}">${v}/S</button>`).join('')}</div><p class="form-note">STA 1 หน่วย = 1 เมตรจากหมุด STA ต่ำไปตามแนวเส้น · Offset ตั้งฉากในระนาบ UTM หากระยะกับช่วง STA ต่างกัน กรุณาตรวจสอบข้อมูลหมุดก่อนใช้แผน</p><div class="survey-toolbar">${button('add-plan','เพิ่มรายการ')}${button('csv-template','CSV ตัวอย่าง')}<label class="module-secondary survey-upload">นำเข้า CSV<input type="file" accept=".csv,text/csv" data-csv></label>${button('process','Process สร้างตำแหน่ง',true)}</div>${data.planStale?'<p class="survey-warning">แผนมีการแก้ไข กด Process เพื่อปรับตำแหน่งบนแผนที่</p>':''}${table(['Instrument ID / Type','STA','Offset / U/D','จัดการ'],data.draft.map((p,i)=>`<tr><td><strong>${esc(p.instrumentId)}</strong><small>${esc(p.type)}</small></td><td>${esc(p.sta)}</td><td>${esc(p.offset)} m · ${esc(p.side)}</td><td><div class="survey-row-actions"><button type="button" data-edit-plan="${i}">แก้ไข</button><button type="button" data-delete-plan="${i}">ลบ</button></div></td></tr>`))}${data.plans.some(p=>p.extrapolated)?'<p class="survey-warning">มีรายการ STA อยู่นอกช่วงหมุดอ้างอิง คำนวณด้วยการต่อแนวเส้นออกไป</p>':''}`:`${data.planStale?'<p class="survey-warning">ข้อมูลแผนเปลี่ยนแล้ว กรุณา Process แผนก่อนตรวจตำแหน่งจริง</p>':''}${table(['Instrument ID / Type','ตามแผน','ติดตั้งจริง','จัดการ'],data.plans.map(p=>{const actual=data.actuals[p.instrumentId],changed=actual&&core().changes(p,actual).changed;return `<tr><td><strong>${esc(p.instrumentId)}</strong><small>${esc(p.type)}</small></td><td>${esc(p.sta)} · ${p.offset} m ${esc(p.side)}${coordinateButtons(p)}</td><td>${actual?`<span class="${changed?'survey-warning':''}">${changed?'⚠ เปลี่ยนจากแผน':'ตรงตามแผน'} · ${esc(actual.sta)} · ${actual.offset} m ${esc(actual.side)}</span>${coordinateButtons(actual)}<small>Elevation ${rounded(actual.elevation)} m</small>`:'ยังไม่บันทึก'}</td><td><button type="button" data-actual="${esc(p.instrumentId)}">${actual?'แก้ไข':'กรอกตำแหน่งจริง'}</button></td></tr>`;}))}`}</div><aside class="survey-map-pane"><div class="survey-map" aria-label="แผนที่ Survey"></div><p class="form-note">${tab==='actual'?'หมุดตามแผนสีเดียวกัน แยกสัญลักษณ์ตามประเภท · หมุดจริงแสดงขอบเข้ม':'กดหมุดเพื่อดูพิกัดและคัดลอก'}</p><div class="survey-legend"></div></aside></div>`}</section>`;
      bind(); if(zone)drawMap();
    }
    function showError(e){error=e.message||String(e);const node=host.querySelector('.survey-error');if(node)node.textContent=error;}
    async function drawMap() {
      const serial=++mapSerial,node=host.querySelector('.survey-map');if(!node)return;
      try{
        const maps=await loadMaps();if(serial!==mapSerial||!node.isConnected)return;
        map=new maps.Map(node,{center:{lat:Number(site.latitude)||13.7,lng:Number(site.longitude)},zoom:15,mapTypeId:'hybrid',fullscreenControl:true,streetViewControl:false,gestureHandling:'cooperative'});
        const bounds=new maps.LatLngBounds(),info=new maps.InfoWindow();let count=0;
        const points=tab==='references'?refs():[...data.plans,...(tab==='actual'?Object.entries(data.actuals).filter(([key])=>data.plans.some(p=>p.instrumentId===key)).map(([key,p])=>({...p,instrumentId:key+' · จริง',type:data.plans.find(r=>r.instrumentId===key)?.type,actual:true})):[])];
        for(const p of points){if(p.latitude==null||p.longitude==null)continue;const position={lat:Number(p.latitude),lng:Number(p.longitude)},index=Math.max(0,types.indexOf(p.type)),color=tab==='actual'?'#9B6545':['#916147','#267982','#61559C','#AD493F','#46763F'][index%5];
          const marker=new maps.Marker({map,position,title:p.name||p.instrumentId,label:{text:p.name||p.instrumentId,color:'#fff',fontSize:'12px',fontWeight:'700'},icon:{path:symbol(index),fillColor:color,fillOpacity:1,strokeColor:p.actual?'#182C23':'#fff',strokeWeight:p.actual?4:2,scale:1.4,labelOrigin:new maps.Point(0,-20)},zIndex:p.actual?20:10});bounds.extend(position);count++;
          marker.addListener('click',()=>{const content=document.createElement('div');content.className='survey-map-info';content.innerHTML=`<strong>${esc(p.name||p.instrumentId)}</strong><p>${esc(p.type||p.flag)} · ${esc(p.sta||'')}</p>${coordinateButtons(p)}`;content.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copy(b));info.setContent(content);info.open({anchor:marker,map});});
        }
        if(tab!=='references'){try{const a=line(),path=[a.a,a.b].map(p=>({lat:p.latitude,lng:p.longitude}));new maps.Polyline({map,path,strokeColor:'#F4C45B',strokeWeight:3});path.forEach(p=>bounds.extend(p));count+=2;}catch(_){}}
        if(count){map.fitBounds(bounds,45);if(count===1)maps.event.addListenerOnce(map,'idle',()=>map.setZoom(18));}
        host.querySelector('.survey-legend').innerHTML=tab==='references'?`${refs().length} หมุดอ้างอิง`:[...new Set(data.plans.map(p=>p.type))].map(type=>`<span><svg viewBox="-12 -12 24 24" width="18" height="18" aria-hidden="true"><path d="${symbol(Math.max(0,types.indexOf(type)))}" fill="#8f5f42"/></svg> ${esc(type)}</span>`).join('');
      }catch(e){node.textContent=`เปิดแผนที่ไม่ได้: ${e.message} · ยังบันทึกและคำนวณพิกัดได้`;}
    }
    async function copy(button){try{await navigator.clipboard.writeText(button.dataset.copy);const label=button.innerHTML;button.textContent='คัดลอกแล้ว';setTimeout(()=>button.innerHTML=label,1100);}catch(_){showError(new Error('คัดลอกไม่ได้ กรุณาใช้เว็บผ่าน HTTPS'));}}
    function bind() {
      host.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;error='';render();});
      host.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copy(b));
      host.querySelectorAll('[data-ref]').forEach(select=>select.onchange=()=>{data.alignment[select.dataset.ref]=select.value;data.planStale=!!data.plans.length;persist();render();});
      host.querySelectorAll('[data-left]').forEach(b=>b.onclick=()=>{data.alignment.leftSide=b.dataset.left;data.planStale=!!data.plans.length;persist();render();});
      host.querySelectorAll('[data-edit-ref]').forEach(b=>b.onclick=()=>referenceEditor(b.dataset.editRef));
      host.querySelectorAll('[data-delete-ref]').forEach(b=>b.onclick=async()=>{const key=b.dataset.deleteRef;if([data.alignment.first,data.alignment.second].includes(key))return showError(new Error('หมุดนี้เป็น Ref ของแผน กรุณาเปลี่ยนหมุดอ้างอิงก่อนลบ'));if(!await authorizeDelete('ลบหมุดอ้างอิง','ลบหมุดและรูปภาพของหมุดนี้'))return;try{const ref=refs().find(p=>p.id===key);for(const photo of ref.photos||[])await deleteImage(photo.id);data.references=refs().filter(p=>p.id!==key);persist();render();}catch(e){showError(e);}});
      host.querySelectorAll('[data-photo-list]').forEach(b=>b.onclick=()=>{const ref=refs().find(p=>p.id===b.dataset.photoList),node=dialog(`รูปภาพ · ${ref.name}`,`<div class="survey-photo-list">${ref.photos.map((p,i)=>`<button type="button" data-photo="${esc(p.id)}">รูป ${i+1}</button>`).join('')}</div>`);node.querySelectorAll('[data-photo]').forEach(p=>p.onclick=()=>viewPhoto(p.dataset.photo));});
      host.querySelectorAll('[data-edit-plan]').forEach(b=>b.onclick=()=>draftEditor(Number(b.dataset.editPlan)));
      host.querySelectorAll('[data-delete-plan]').forEach(b=>b.onclick=async()=>{if(!await authorizeDelete('ลบรายการในแผน','ตำแหน่งตามแผนจะเปลี่ยนหลัง Process'))return;data.draft.splice(Number(b.dataset.deletePlan),1);data.planStale=true;persist();render();});
      host.querySelectorAll('[data-actual]').forEach(b=>b.onclick=()=>actualEditor(b.dataset.actual));
      host.querySelectorAll('[data-sv]').forEach(b=>b.onclick=()=>{try{error='';switch(b.dataset.sv){case'add-ref':referenceEditor();break;case'add-plan':draftEditor();break;case'line':line();render();break;case'csv-template':download('survey-plan-template.csv',`Instrument ID,Instrument Type,STA,Offset,U/D\r\nSM-01,${types[0]||'Soil Moisture Sensor'},0+100,5,U\r\n`);break;case'process':if(!data.draft.length)throw new Error('เพิ่มรายการหรือนำเข้า CSV ก่อน Process');data.plans=core().processPlan(data.draft,refs().find(p=>p.id===data.alignment.first),refs().find(p=>p.id===data.alignment.second),data.alignment.leftSide,zone,types);data.planStale=false;persist();render();break;}}catch(e){showError(e);}});
      const csv=host.querySelector('[data-csv]');if(csv)csv.onchange=async()=>{const file=csv.files[0];if(!file)return;try{const rows=parseCsv(await file.text()),normalized=rows.map(row=>{const get=(...keys)=>keys.map(k=>row[k]).find(v=>v!==undefined);return {instrumentId:get('instrument id','instrument_id','instrumentid'),type:get('instrument type','instrument_type','type'),sta:get('sta'),offset:get('offset'),side:get('u/d','u_d','side')};});if(!normalized.length)throw new Error('CSV ไม่มีข้อมูล');const seen=new Set(data.draft.map(p=>p.instrumentId.toLowerCase()));for(const [index,p] of normalized.entries()){if(!String(p.instrumentId||'').trim())throw new Error(`แถว ${index+2}: ไม่พบ Instrument ID`);if(seen.has(p.instrumentId.toLowerCase()))throw new Error(`แถว ${index+2}: Instrument ID ซ้ำ`);seen.add(p.instrumentId.toLowerCase());p.type=types.find(t=>t.toLowerCase()===String(p.type||'').trim().toLowerCase());if(!p.type)throw new Error(`แถว ${index+2}: ประเภท Instrument ไม่ตรงกับระบบ`);p.side=String(p.side||'').toUpperCase();if(!['U','D','CL'].includes(p.side))throw new Error(`แถว ${index+2}: U/D ต้องเป็น U, D หรือ CL`);Object.assign(p,validateAlignment(p));}data.draft.push(...normalized);data.planStale=!!data.plans.length;persist();error='';render();}catch(e){showError(new Error(`${file.name}: ${e.message}`));}finally{csv.value='';}};
    }
    render();
  }
  window.WorkHubSurvey=Object.freeze({mount});
})();
