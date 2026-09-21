(function () {
  'use strict';
  const queues = new Map();
  const revisions = new Map();
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  async function load(module, storageKey, fallback) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
    const initial = local || fallback;
    if (!window.V2Api || !window.V2Api.getEndpoint()) return { data:initial, remote:false };
    try {
      const result = await window.V2Api.call('getModuleState', { module, initialState:initial });
      const data = result.state || initial;
      revisions.set(module, Number(result.revision)||0);
      localStorage.setItem(storageKey, JSON.stringify(data));
      return { data, remote:true, imported:!!result.imported, revision:result.revision };
    } catch (error) {
      console.warn(`WorkHub ${module} database load failed`, error);
      return { data:initial, remote:false, error };
    }
  }
  function save(module, storageKey, value, onStatus) {
    const snapshot = clone(value);
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
    const previous = queues.get(module);
    if (previous?.timer) clearTimeout(previous.timer);
    const entry = previous || { chain:Promise.resolve(), timer:null };
    entry.timer = setTimeout(() => {
      entry.timer=null;
      if (!window.V2Api || !window.V2Api.getEndpoint()) return onStatus?.('local');
      onStatus?.('saving');
      entry.saving=true;
      entry.chain = entry.chain.catch(() => {}).then(() => window.V2Api.call('saveModuleState', { module, state:snapshot, expectedRevision:revisions.get(module)||0 }))
        .then(result => { revisions.set(module,Number(result.revision)||0);onStatus?.('saved'); })
        .catch(error => { console.error(`WorkHub ${module} database save failed`, error); onStatus?.(error.code==='MODULE_STATE_CONFLICT'?'conflict':'error', error); })
        .finally(()=>{entry.saving=false;});
    }, 250);
    queues.set(module, entry);
  }
  async function refresh(module, storageKey) {
    if (!window.V2Api || !window.V2Api.getEndpoint()) return { changed:false, remote:false };
    const pending=queues.get(module);if(pending?.timer||pending?.saving)return { changed:false, pending:true };
    const result=await window.V2Api.call('getModuleState',{module});
    const current=Number(revisions.get(module)||0),remote=Number(result.revision)||0;
    if(remote<=current||!result.state)return {changed:false,revision:remote};
    revisions.set(module,remote);localStorage.setItem(storageKey,JSON.stringify(result.state));
    return {changed:true,data:result.state,revision:remote,updatedAt:result.updatedAt};
  }
  async function listSnapshots(module) {
    if (!window.V2Api || !window.V2Api.getEndpoint()) return [];
    const result=await window.V2Api.call('listModuleSnapshots',{module});
    return result.snapshots||[];
  }
  async function restoreSnapshot(module, storageKey, snapshotId) {
    if (!window.V2Api || !window.V2Api.getEndpoint()) throw new Error('ต้องเชื่อมต่อฐานข้อมูลก่อนย้อนคืนเวอร์ชัน');
    const pending=queues.get(module);if(pending?.timer)clearTimeout(pending.timer);if(pending?.chain)await pending.chain.catch(()=>{});queues.delete(module);
    const result=await window.V2Api.call('restoreModuleSnapshot',{module,snapshotId});
    revisions.set(module, Number(result.revision)||0);
    localStorage.setItem(storageKey,JSON.stringify(result.state));
    return result;
  }
  window.WorkHubModuleStore = Object.freeze({ load, save, refresh, listSnapshots, restoreSnapshot });
})();
