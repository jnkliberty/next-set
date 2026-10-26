import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, copyWeek, addWeek } from '../domain/programs.js';
import { validateStoredRow } from '../server/schema.js';
import { withChanges } from '../domain/edits.js';

const fixture = () => ({program:[{id:'p',name:'Example'}],program_day:[{id:'d1',program_id:'p',week:1,day:1,position:0,title:'Upper'},{id:'d2',program_id:'p',week:2,day:1,position:1,title:'Lower'}],slot:[{id:'s',program_day_id:'d1',position:0,exercise_id:'e',group_id:'pair',group_kind:'superset'},{id:'t',program_day_id:'d2',position:0,exercise_id:'f'}],slot_set:[{id:'ss',slot_id:'s',position:0,type:'working',reps_min:6,reps_max:8}],session:[{id:'old',program_day_id:'d2'}],session_slot:[],set:[]});

test('new programs derive day count from selected weekdays and clone source weeks without changing history',()=>{
  const data=fixture(), before=JSON.stringify(data);
  const result=createProgram(data,{name:' My plan ',weeks:3,weekdays:[1,4],sourceId:'p',date:'2026-10-25'});
  const days=result.changes.filter(c=>c.table==='program_day').map(c=>c.row);
  assert.equal(result.changes.find(c=>c.table==='program').row.name,'My plan');
  assert.deepEqual(days.map(d=>[d.week,d.day,d.position,d.title]),[[1,1,0,'Upper'],[1,2,1,''],[2,1,2,'Lower'],[2,2,3,''],[3,1,4,'Upper'],[3,2,5,'']]);
  assert.equal(result.changes.filter(c=>c.table==='slot').length,3);
  assert.deepEqual(result.changes.find(c=>c.table==='run_setting').row.weekdays,[1,4]);
  const saved=withChanges(data,result.changes);
  for(const {table,row} of result.changes)validateStoredRow(table,{...saved[table].find(r=>r.id===row.id),rev:1,device_id:'fixture',updated_at:1});
  assert.equal(JSON.stringify(data),before);
  assert.ok(!result.changes.some(c=>['session','session_slot','set'].includes(c.table)));
  for(const args of [{name:'',weeks:2,weekdays:[1]},{name:'x',weeks:0,weekdays:[1]},{name:'x',weeks:2,weekdays:[]},{name:'x',weeks:2,weekdays:[1,1]}])assert.throws(()=>createProgram(data,args));
});

test('week copies require overwrite consent, preserve session snapshots, and add weeks after existing positions',()=>{
  const data=fixture();
  assert.throws(()=>copyWeek(data,'p',1,[2]),/replace/i);
  const copied=copyWeek(data,'p',1,[2],{overwrite:true});
  assert.ok(copied.changes.some(c=>c.table==='slot'&&c.row.id==='t'&&c.row.deleted_at));
  assert.equal(copied.changes.find(c=>c.table==='program_day').row.title,'Upper');
  assert.ok(!copied.changes.some(c=>['session','session_slot','set'].includes(c.table)));
  const added=addWeek(withChanges(data,copied.changes),'p');
  assert.deepEqual(added.changes.map(c=>[c.row.week,c.row.day,c.row.position,c.row.title]),[[3,1,2,'']]);
  assert.throws(()=>copyWeek(data,'p',1,[1]),/different/i);
});
