(function () {
  'use strict';
  const queues = new Map();
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  async function load(module, storageKey, fallback) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
    const initial = local || fallback;
    if (!window.V2Api || !window.V2Api.getEndpoint()) return { data:initial, remote:false };
    try {
      const result = await window.V2Api.call('getModuleState', { module, initialState:initial });
      const data = result.state || initial;
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
      if (!window.V2Api || !window.V2Api.getEndpoint()) return onStatus?.('local');
      onStatus?.('saving');
      entry.chain = entry.chain.catch(() => {}).then(() => window.V2Api.call('saveModuleState', { module, state:snapshot }))
        .then(() => onStatus?.('saved'))
        .catch(error => { console.error(`WorkHub ${module} database save failed`, error); onStatus?.('error', error); });
    }, 250);
    queues.set(module, entry);
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
    localStorage.setItem(storageKey,JSON.stringify(result.state));
    return result;
  }
  window.WorkHubModuleStore = Object.freeze({ load, save, listSnapshots, restoreSnapshot });
})();
