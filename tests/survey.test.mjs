import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import proj4 from 'proj4';

const context=vm.createContext({window:{proj4}});
new vm.Script(await fs.readFile(new URL('../frontend/survey-core.js',import.meta.url),'utf8')).runInContext(context);
const core=context.window.WorkHubSurveyCore;
const near=(a,b,tolerance=0.001)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);

test('WGS84 UTM conversion matches central meridian and round-trips in both Thai zones',()=>{
  for(const [zone,longitude] of [[47,99],[48,105]]) {
    const origin=core.convert({latitude:0,longitude},'latlong',zone);
    near(origin.easting,500000);near(origin.northing,0);
    const forward=core.convert({latitude:18.7654321,longitude:longitude+1},'latlong',zone);
    const inverse=core.convert(forward,'utm',zone);
    near(inverse.latitude,18.7654321,1e-8);near(inverse.longitude,longitude+1,1e-8);
  }
  assert.equal(core.zoneForSite({longitude:102}),47);
  assert.equal(core.zoneForSite({longitude:102.0001}),48);
  assert.throws(()=>core.zoneForSite({longitude:''}));
});

test('STA parses kilometres and rejects incomplete or invalid station syntax',()=>{
  assert.equal(core.station('1+250'),1250);assert.equal(core.station('1+025.5'),1025.5);
  assert.equal(core.station('1250'),1250);
  assert.equal(core.stationText(1025.5),'1+025.5');
  for(const value of ['',null,'-1','1+1250','0+abc'])assert.throws(()=>core.station(value));
});

const ref=(id,easting,northing,sta)=>({...core.convert({easting,northing},'utm',47),id,sta});
test('alignment always faces increasing STA, U/D remain correct when refs are reversed',()=>{
  const a=ref('a',500000,1500000,'0+100'),b=ref('b',500100,1500000,'0+200');
  const rows=[{instrumentId:'SM1',type:'soil moisture sensor',sta:'0+150',offset:10,side:'U'},{instrumentId:'SM2',type:'Soil Moisture Sensor',sta:'0+150',offset:10,side:'D'}];
  for(const refs of [[a,b],[b,a]]) {
    const points=core.processPlan(rows,...refs,'U',47,['Soil Moisture Sensor']);
    near(points[0].easting,500050);near(points[0].northing,1500010);
    near(points[1].northing,1499990);
    assert.equal(points[0].type,'Soil Moisture Sensor');
  }
  const swapped=core.processPlan(rows,a,b,'D',47,['Soil Moisture Sensor']);
  near(swapped[0].northing,1499990);
});

test('STA is metres without silently stretching distance and CL has zero offset',()=>{
  const a=ref('a',500000,1500000,'0+000'),b=ref('b',500000,1500200,'0+100');
  const p=core.processPlan([{instrumentId:'I',type:'T',sta:50,offset:0,side:'CL'}],a,b,'U',47,['T'])[0];
  near(p.easting,500000);near(p.northing,1500050);
  assert.throws(()=>core.processPlan([{instrumentId:'I',type:'T',sta:50,offset:1,side:'CL'}],a,b,'U',47,['T']));
  assert.throws(()=>core.alignment(a,{...b,sta:a.sta},47));
});

test('invalid import values cannot generate coordinates and actual changes flag either side',()=>{
  const a=ref('a',500000,1500000,0),b=ref('b',500000,1500100,100),row={instrumentId:'I',type:'T',sta:50,offset:1,side:'U'};
  for(const patch of [{offset:-1},{side:'bad'},{type:'unknown'},{sta:''},{instrumentId:''}])assert.throws(()=>core.processPlan([{...row,...patch}],a,b,'U',47,['T']));
  assert.throws(()=>core.processPlan([row,row],a,b,'U',47,['T']));
  assert.equal(core.changes(row,{...row}).changed,false);
  assert.equal(core.changes(row,{...row,sta:49}).changed,true);
  assert.equal(core.changes(row,{...row,side:'D'}).changed,true);
});
