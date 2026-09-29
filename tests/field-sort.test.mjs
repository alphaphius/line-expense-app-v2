import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../frontend/field-layout.js',import.meta.url),'utf8');
function harness(reduced=false){
  const listeners=new Map(),windowListeners=new Map();let frame,commits=0,animations=0;
  const classes=()=>({add(){},remove(){}});
  const body={append(){},addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({top:0,bottom:800})};
  const parent={dataset:{},parentElement:body,closest:()=>null,querySelectorAll:selector=>selector==='handle'?nodes.map(n=>n.handle):nodes.slice(),insertBefore(node,target){nodes.splice(nodes.indexOf(node),1);nodes.splice(target?nodes.indexOf(target):nodes.length,0,node);},append(node){this.insertBefore(node,null);}};
  const nodes=['a','b','c'].map(id=>{const node={id,parentElement:parent,classList:classes(),getBoundingClientRect:()=>({left:0,top:nodes.indexOf(node)*100,width:300,height:90}),getAnimations:()=>[],animate(){animations++;},closest:()=>node,cloneNode:()=>({style:{},classList:classes(),querySelectorAll:()=>[],removeAttribute(){},setAttribute(){},remove(){}})};Object.defineProperty(node,'nextSibling',{get:()=>nodes[nodes.indexOf(node)+1]||null});node.handle={style:{},closest:()=>node,setAttribute(){},removeAttribute(){}};return node;});
  const document={body,elementFromPoint:()=>nodes.find(n=>n.id==='c'),addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
  const window={addEventListener:(key,fn)=>windowListeners.set(key,fn),removeEventListener:key=>windowListeners.delete(key)};
  const context=vm.createContext({window,document,matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({overflowY:'visible'}),performance:{now:()=>200},requestAnimationFrame:fn=>(frame=fn,1),cancelAnimationFrame(){}});
  new vm.Script(source).runInContext(context);
  window.WorkHubFieldLayout.bindSort(parent,{itemSelector:'item',handleSelector:'handle',onCommit:()=>commits++});
  nodes[0].handle.onpointerdown({button:0,pointerId:1,clientX:20,clientY:20,preventDefault(){},stopPropagation(){}});
  listeners.get('pointermove')({pointerId:1,clientX:20,clientY:220,preventDefault(){}});frame();
  return {nodes,parent,listeners,windowListeners,commits:()=>commits,animations:()=>animations};
}
test('drag previews the new order and animates before release; commits only on drop',()=>{
  const h=harness();assert.deepEqual(h.nodes.map(n=>n.id),['b','c','a']);assert.equal(h.commits(),0);assert.equal(h.parent.dataset.sorting,'true');assert.equal(h.animations(),3);
  h.listeners.get('pointerup')({pointerId:1});assert.equal(h.commits(),1);assert.equal(h.parent.dataset.sorting,undefined);assert.equal(h.listeners.size,0);assert.equal(h.windowListeners.size,0);
});
for(const reason of ['pointercancel','Escape','blur'])test(`cancel by ${reason} restores original order without saving`,()=>{
  const h=harness();if(reason==='Escape')h.listeners.get('keydown')({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});else if(reason==='blur')h.windowListeners.get('blur')();else h.listeners.get(reason)();
  assert.deepEqual(h.nodes.map(n=>n.id),['a','b','c']);assert.equal(h.commits(),0);
});
test('reduced motion preserves live preview without animation',()=>{const h=harness(true);assert.equal(h.animations(),0);assert.deepEqual(h.nodes.map(n=>n.id),['b','c','a']);});
