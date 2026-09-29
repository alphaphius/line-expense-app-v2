(function () {
  'use strict';
  const numeric = (value, label) => {
    if (value === '' || value == null || !Number.isFinite(Number(value))) throw new Error(`กรุณาระบุ ${label} เป็นตัวเลข`);
    return Number(value);
  };
  function zoneForSite(site) {
    const longitude = numeric(site.longitude, 'Longitude ของไซต์');
    if (longitude < 96 || longitude > 108) throw new Error('พิกัดไซต์ต้องอยู่ในเขต UTM 47 หรือ 48');
    return longitude > 102 ? 48 : 47;
  }
  function projection(zone) {
    if (![47,48].includes(Number(zone))) throw new Error('เลือก UTM Zone 47N หรือ 48N');
    return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
  }
  function convert(point, source, zone) {
    const crs = projection(zone);
    let latitude, longitude, easting, northing;
    if (source === 'utm') {
      easting=numeric(point.easting,'UTM E'); northing=numeric(point.northing,'UTM N');
      if(easting<100000||easting>900000||northing<0||northing>9400000) throw new Error('ค่า UTM อยู่นอกช่วงที่รองรับ กรุณาตรวจ Zone และพิกัด');
      [longitude,latitude]=window.proj4(crs,'EPSG:4326',[easting,northing]);
    } else {
      latitude=numeric(point.latitude,'Latitude'); longitude=numeric(point.longitude,'Longitude');
      if(latitude<0||latitude>84||longitude<96||longitude>108) throw new Error('กรุณาตรวจ Latitude / Longitude (ระบบใช้ UTM 47N / 48N)');
      [easting,northing]=window.proj4('EPSG:4326',crs,[longitude,latitude]);
    }
    if(![latitude,longitude,easting,northing].every(Number.isFinite))throw new Error('แปลงพิกัดไม่ได้ กรุณาตรวจค่าพิกัดและ Zone');
    return {...point,latitude,longitude,easting,northing,zone:Number(zone)};
  }
  function station(value) {
    const text=String(value??'').trim();
    const match=/^(\d+)\+(\d{1,3}(?:\.\d+)?)$/.exec(text);
    if(match) return Number(match[1])*1000+Number(match[2]);
    if(!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('STA ต้องเป็น 1+250 หรือ 1250 (เมตร)');
    return Number(text);
  }
  function stationText(value) {
    const metres=Number(station(value).toFixed(3)),km=Math.floor(metres/1000),rest=Number((metres-km*1000).toFixed(3)),parts=String(rest).split('.');
    return `${km}+${parts[0].padStart(3,'0')}${parts[1]?'.'+parts[1]:''}`;
  }
  function alignment(first,second,zone) {
    if(!first||!second||first.id===second.id) throw new Error('เลือกหมุดอ้างอิงสองหมุดที่ต่างกัน');
    let a=convert(first,'latlong',zone),b=convert(second,'latlong',zone);
    a={...a,station:station(a.sta)}; b={...b,station:station(b.sta)};
    if(a.station===b.station) throw new Error('หมุดอ้างอิงต้องมี STA ต่างกัน');
    if(a.station>b.station) [a,b]=[b,a];
    const de=b.easting-a.easting,dn=b.northing-a.northing,distance=Math.hypot(de,dn);
    if(distance<.001) throw new Error('หมุดอ้างอิงอยู่ตำแหน่งเดียวกัน');
    const stationSpan=b.station-a.station;
    return {a,b,distance,stationSpan,scale:distance/stationSpan,e:de/distance,n:dn/distance};
  }
  function processPlan(rows,first,second,leftSide,zone,types) {
    if(!['U','D'].includes(leftSide)) throw new Error('เลือกฝั่งซ้ายเป็น U/S หรือ D/S');
    const line=alignment(first,second,zone),ids=new Set();
    return rows.map((row,index)=>{
      try {
        const id=String(row.instrumentId||'').trim(),type=types.find(name=>name.toLowerCase()===String(row.type||'').trim().toLowerCase());
        if(!id) throw new Error('ต้องมี Instrument ID');
        if(ids.has(id.toLowerCase())) throw new Error(`Instrument ID ${id} ซ้ำ`);
        ids.add(id.toLowerCase());
        if(!type) throw new Error('Instrument Type ไม่ตรงกับรายการในระบบ');
        const sta=station(row.sta),offset=numeric(row.offset,'Offset'),side=String(row.side||'').trim().toUpperCase();
        if(offset<0) throw new Error('Offset ต้องไม่ติดลบ ใช้ U/D เพื่อระบุฝั่ง');
        if(!['U','D','CL'].includes(side)) throw new Error('U/D ต้องเป็น U, D หรือ CL');
        if(side==='CL'&&offset!==0) throw new Error('CL ต้องมี Offset เท่ากับ 0');
        const along=sta-line.a.station,sign=side==='CL'?0:side===leftSide?1:-1;
        const point=convert({easting:line.a.easting+along*line.e-sign*offset*line.n,northing:line.a.northing+along*line.n+sign*offset*line.e},'utm',zone);
        return {...row,...point,instrumentId:id,type,sta:stationText(sta),offset,side,extrapolated:sta<line.a.station||sta>line.b.station};
      } catch(error) {throw new Error(`รายการ ${index+1}: ${error.message}`);}
    });
  }
  function changes(plan,actual) {
    const staDelta=station(actual.sta)-station(plan.sta),offsetDelta=numeric(actual.offset,'Offset')-numeric(plan.offset,'Offset');
    return {changed:Math.abs(staDelta)>.001||Math.abs(offsetDelta)>.001||actual.side!==plan.side,staDelta,offsetDelta};
  }
  window.WorkHubSurveyCore=Object.freeze({zoneForSite,convert,station,stationText,alignment,processPlan,changes});
})();
