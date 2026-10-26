import { openLocal } from '../client/db.js';
window.faultReady = (async () => {
  const local = await openLocal(event=>{window.lastSync=event;}); window.faultStore = local; await local.sync(); return true;
})();
