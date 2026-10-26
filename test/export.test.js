import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { tables } from '../server/schema.js';
import { restoreExport } from '../server/export.js';
import { exportData, exportHashes } from '../domain/export.js';
import { fingerprints } from '../domain/fingerprint.js';
import { targetReason, targetReasonChange } from '../domain/targets.js';

test('every exported table, tombstone and edit field survives restore with identical hashes', async t=>{
  const source=new Store(':memory:'), target=new Store(':memory:');t.after(()=>{source.close();target.close();});
  const put=(table,row)=>source.apply({id:crypto.randomUUID(),table,row:{...row,rev:1,device_id:'fixture',updated_at:1,deleted_at:null}});
  const rows={
    exercise:{name:'Example',equipment:'barbell',primary:['chest'],secondary:['triceps'],weight_basis:'total',conditioning:false},
    program:{name:'Example'},program_day:{program_id:'p',position:0},slot:{program_day_id:'d',position:0,exercise_id:'e'},slot_set:{slot_id:'slot',position:0,type:'working'},
    run:{program_id:'p',start_date:'2026-01-01',status:'active',next_position:0},run_setting:{run_id:'r',from_date:'2026-01-01',days_per_week:3,weekdays:[1,3,5],weekly_target:3},
    run_event:{run_id:'r',kind:'skipped',local_date:'2026-01-01'},session:{started_at:1,timezone:'America/Chicago',local_date:'2026-01-01',status:'done',source:'app'},
    session_slot:{session_id:'s',position:0,exercise_id:'e',name:'Example'},set:{session_slot_id:'ss',position:0,type:'working',local_date:'2026-01-01',grams:1000,reps_left:2,done_at:10},
    event:{device:'phone',kind:'logged',time:1,detail:{taps:1}},setting:{value:80000},
  };
  for(const [table,row] of Object.entries(rows))put(table,{id:table,...row});
  source.apply({id:'edit',table:'set',row:{...source.get('set','set'),rev:2,grams:1100}});
  source.apply({id:'delete',table:'slot',row:{...source.get('slot','slot'),rev:2,deleted_at:2}});
  put('setting', targetReasonChange(source.get('set','set'), 'first_time').row);
  put('setting', { id: 'favorite:e', value: true });
  const snapshot=Object.fromEntries(tables.map(table=>[table,source.rows(table,true)]));
  restoreExport(target,JSON.parse(JSON.stringify(exportData(snapshot))));
  const restored=Object.fromEntries(tables.map(table=>[table,target.rows(table,true)]));
  assert.deepEqual(await exportHashes(restored),await exportHashes(snapshot));
  assert.equal(targetReason(target.get('set','set'), target.get('setting','target-reason:set')).code, 'first_time');
  assert.equal(target.get('setting','favorite:e').value, true);
  assert.ok(target.rows('set_edit').length>0);
  assert.equal(target.rows('slot').length,0);
  const dates=['2026-01-01'], before=await fingerprints(snapshot.set,dates);
  restored.set[0].grams++;
  assert.notEqual((await fingerprints(restored.set,dates))[0].hash,before[0].hash);
  assert.throws(()=>restoreExport(target,exportData(snapshot)),/empty/);
});
