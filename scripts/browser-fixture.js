import { Store } from '../server/store.js';
import { createApi } from '../server/api.js';
import { tables } from '../server/schema.js';
import { todayDate, addDays } from '../domain/calendar.js';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep, basename } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { build } from 'vite';
import { fullSizeFixture } from './full-size-fixture.js';
import { progressFixture } from './progress-fixture.js';

const path = process.argv[2];
const actual = path && (existsSync(path) ? realpathSync(path) : resolve(realpathSync(dirname(path)),basename(path)));
if (!actual || !actual.startsWith(`${realpathSync(tmpdir())}${sep}`)) throw new Error('Fixture database must be inside the temporary directory');
const store = new Store(actual);
let faultCode = null;
if(process.argv.includes('--fault')){
  const result=await build({configFile:false,publicDir:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:resolve('scripts/fault-entry.js'),formats:['es']}}});
  faultCode=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
}
function seed() {
  for (const table of [...tables, '_operation']) store.db.exec(`DELETE FROM "${table}"`);
  store.db.exec('UPDATE _clock SET seq=0');
  if(process.argv.includes('--full-size')) { fullSizeFixture(store); return; }
  const progressMode = process.argv.find(arg => arg.startsWith('--progress='))?.split('=')[1];
  if(progressMode) { progressFixture(store, progressMode); return; }
  const put = (table, row) => store.apply({ id: `fixture:${table}:${row.id}`, table, row: { ...row, rev: 1, device_id: 'fixture', updated_at: 1, deleted_at: null } });
  for (const [id,name,muscle] of [['press','Bench Press','chest'],['row','Barbell Row','middle back'],['decline','Decline Press','chest']]) put('exercise', { id, name, equipment: 'barbell', primary: [muscle], secondary: ['triceps'], conditioning: false, weight_basis: 'total', pinned_note: '' });
  put('program', { id: 'sample', name: 'Sample Strength', source: 'fixture' });
  for (const position of [0,1,2]) {
    const day = `day-${position}`; put('program_day', { id: day, program_id: 'sample', position, week: 1, day: position+1, title: `Sample Strength / Week 1 / Day ${position+1}` });
    for (const [i,exercise] of ['press','row'].entries()) {
      const slot = `${day}-${exercise}`; put('slot', { id: slot, program_day_id: day, position: i, exercise_id: exercise, rest_seconds: 90, pinned_note: 'Made-up training fixture.' });
      for (const k of [0,1]) put('slot_set', { id: `${slot}-${k}`, slot_id: slot, position: k, type: 'working', reps_min: 4, reps_max: 6, target_effort: 8 });
    }
  }
  for (const n of [1,2]) {
    const session = `past-${n}`, date = addDays(todayDate(), -n*3), start = Date.parse(`${date}T12:00:00Z`);
    put('session', { id: session, started_at: start, ended_at: start+1800000, timezone: 'America/Chicago', local_date: date, source: 'app', status: 'done', off: false });
    for (const [i,exercise] of ['press','row','decline'].entries()) {
      const slot = `${session}-${exercise}`; put('session_slot', { id: slot, session_id: session, position: i, exercise_id: exercise, planned_exercise_id: exercise, name: exercise });
      for (const k of [0,1]) put('set', { id: `${slot}-${k}`, session_slot_id: slot, position: k, type: 'working', weight: exercise==='press'?100:60, grams: exercise==='press'?100000:60000, unit: 'kg', reps: 6,
        target_reps_min: 4, target_reps_max: 6, target_effort: 8, reps_left: null, effort_source: 'assumed', local_date: date, done_at: start+k*60000 });
    }
  }
}
seed();
const server = createApi(store), original = server.listeners('request')[0];
let listenPort;
server.removeAllListeners('request');
server.on('request', (request,response) => {
  if(faultCode && request.url==='/'){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Fixture storage origin</title>');return;}
  if(faultCode && request.url==='/__fault'){
    response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Fabricated fault fixtures</title><script type="module" src="/__fault.js"></script>');return;
  }
  if(faultCode && request.url==='/__fault.js'){response.writeHead(200,{'content-type':'text/javascript'});response.end(faultCode);return;}
  if (request.method==='POST' && request.url==='/__stop') {
    response.writeHead(200,{'content-type':'application/json'});response.end('{"stopping":true}',()=>{
      server.close(()=>setTimeout(()=>server.listen(listenPort,'127.0.0.1'),2000));server.closeAllConnections();
    });return;
  }
  if (request.method==='POST' && request.url==='/__reset') { seed(); response.writeHead(200,{'content-type':'application/json'});response.end('{"ok":true}');return; }
  if (request.method==='POST' && request.url==='/__plant') {
    const row = store.rows('set').find(row=>row.local_date===todayDate()&&row.done_at!=null);
    if(row)store.db.prepare('UPDATE "set" SET document=? WHERE id=?').run(JSON.stringify({...row,grams:(row.grams??0)+123}),row.id);
    response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({planted:!!row}));return;
  }
  original(request,response);
});
server.listen(0,'127.0.0.1',()=>{listenPort=server.address().port;console.log(JSON.stringify({port:listenPort,pid:process.pid}));});
function stop(){if(server.listening)server.close(()=>{store.close();process.exit(0);});else{store.close();process.exit(0);}}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
