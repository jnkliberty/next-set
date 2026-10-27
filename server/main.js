import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Store } from './store.js';
import { createApi } from './api.js';
import { scheduleBackups } from './backup.js';

const path = resolve(process.env.DB_PATH || 'data/workout.sqlite');
const port = Number(process.env.PORT || 18081);
const bindHost=process.env.BIND_HOST||'127.0.0.1';
if(!['127.0.0.1','0.0.0.0'].includes(bindHost))throw new Error('Invalid bind host');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
mkdirSync(dirname(path), { recursive: true });
const store = new Store(path);
const server = createApi(store, { origin: process.env.APP_ORIGIN });
const stopBackups=process.env.BACKUP_DIR?scheduleBackups(store,process.env.BACKUP_DIR):()=>{};
server.listen(port, bindHost, () => console.log(`Workout API on port ${port}; PID ${process.pid}`));
function stop() { stopBackups(); server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
