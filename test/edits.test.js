import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addExtraSets, editWorkout } from '../domain/edits.js';
import { finishChanges, instantiateSlot, startChanges } from '../domain/session.js';
import { todayDate, addDays, copyProgram, projectCalendar } from '../domain/calendar.js';

function fixture(){
  const today=todayDate(), past=addDays(today,-20);
  return {exercise:[{id:'e',name:'Example Press',equipment:'barbell',primary:['chest'],secondary:[],conditioning:false,weight_basis:'total'}],
    program_day:[{id:'day',program_id:'p',position:0,week:1,day:1},{id:'later',program_id:'p',position:1,week:2,day:1}],
    slot:[{id:'sl',program_day_id:'day',position:0,exercise_id:'e'},{id:'sl2',program_day_id:'later',position:0,exercise_id:'e'}],slot_set:[{id:'ss',slot_id:'sl',position:0,type:'working',reps_min:4,reps_max:6}],
    session:[{id:'past',started_at:Date.parse(`${past}T12:00:00Z`),local_date:past,off:false},{id:'now',started_at:Date.now(),local_date:today,status:'open'}],
    session_slot:[{id:'oldslot',session_id:'past',exercise_id:'e',position:0,name:'Example'},{id:'now-slot',session_id:'now',exercise_id:'e',planned_exercise_id:'e',position:0,name:'Example'}],
    set:[{id:'old',session_slot_id:'oldslot',position:0,type:'working',target_reps_min:4,target_reps_max:6,weight:100,unit:'kg',reps:6,done_at:1},{id:'logged',session_slot_id:'now-slot',position:0,type:'working',target_reps_min:4,target_reps_max:6,weight:100,unit:'kg',reps:6,done_at:2},{id:'pending',session_slot_id:'now-slot',position:1,type:'working',target_reps_min:4,target_reps_max:6,weight:100,unit:'kg',reps:6,done_at:null}],
    run_event:[],run_setting:[{run_id:'r',from_date:today,weekdays:[0,1,2,3,4,5,6]}],setting:[]};
}

test('removing or swapping an exercise preserves logged sets and applies reach only to program templates',()=>{
  const data=fixture(), args={day:data.program_day[0],run:{id:'r'},session:data.session[1],slot:data.session_slot[1],action:'remove',scope:'program'};
  const result=editWorkout(data,args);
  assert.ok(!result.changes.some(change=>change.row.id==='logged'));
  assert.ok(result.changes.some(change=>change.row.id==='pending'&&change.row.deleted_at));
  assert.equal(result.changes.filter(change=>change.table==='slot'&&change.row.deleted_at).length,2);
  assert.ok(!result.changes.some(change=>change.row.id==='now-slot'&&change.row.deleted_at));
  assert.equal(data.set[1].target_reps_min,4);
});

test('return prompts retain targets until chosen and timed edits preserve duration without invented rep ranges',()=>{
  const data=fixture();
  const created=instantiateSlot(data,data.session[1],data.slot[0],[{type:'working',position:0,reps_min:4,reps_max:6}]);
  const prompt=created.find(change=>change.table==='setting'&&change.row.id.startsWith('return:'));
  assert.equal(prompt.row.value.days,20);assert.equal(prompt.row.value.recommended,0.05);assert.equal(prompt.row.value.choice,null);
  assert.equal(created.find(change=>change.table==='set').row.target_weight,102.5);
  const timed=editWorkout(data,{day:data.program_day[0],run:{id:'r'},session:data.session[1],action:'add',exerciseId:'e',type:'timed',seconds:45,count:2});
  assert.deepEqual(timed.changes.filter(change=>change.table==='set').map(change=>[change.row.type,change.row.target_seconds,change.row.target_reps_min]),[['timed',45,null],['timed',45,null]]);
});

test('extra sets on any date preserve templates, program copies and normal progression',()=>{
  const data=fixture(), today=todayDate(), run={id:'r',program_id:'p',start_date:today,next_position:0,status:'active'};
  data.program=[{id:'p',name:'Fixture program'}];data.run=[run];
  const before=JSON.stringify([data.program,data.program_day,data.slot,data.slot_set]);
  const date=addDays(today,2), added=addExtraSets(data,run,date,{exerciseId:'e',count:2,low:8,high:10});
  for(const {table,row} of added.changes){data[table]??=[];data[table].push(row);}
  assert.equal(JSON.stringify([data.program,data.program_day,data.slot,data.slot_set]),before);
  assert.equal(copyProgram(data,'p','Copy').changes.filter(change=>change.table==='program_day').length,2);
  const session=data.session.find(row=>row.id===added.sessionId);
  assert.equal(session.program_day_id,null);assert.equal(session.run_id,'r');assert.equal(session.local_date,date);
  assert.equal(data.run_event.at(-1).position,null);
  assert.equal(projectCalendar(data,run,date,date,today)[0].state,'added');
  assert.equal(projectCalendar(data,run,today,today,today)[0].day.id,'day');
  assert.equal(startChanges(data,session)[0].row.local_date,date);
  assert.ok(finishChanges(data,session).every(change=>change.table==='session'));
  assert.equal(run.next_position,0);
  const more=editWorkout(data,{session,run,day:null,action:'add',exerciseId:'e',scope:'today'});
  assert.ok(more.changes.every(change=>['session_slot','set','setting'].includes(change.table)));
});

test('program edits change templates only; every week reaches the same day number and several adds stack in order',async()=>{
  const { editProgram, withChanges } = await import('../domain/edits.js');
  const data=fixture(); data.exercise.push({id:'f',name:'Example Row',equipment:'cable',primary:['lats'],secondary:[],conditioning:false,weight_basis:'total'});
  const week=editProgram(data,{day:data.program_day[0],slot:data.slot[0],action:'sets',count:3,low:8,high:10,rest:60,scope:'week'});
  assert.ok(week.changes.every(change=>['slot','slot_set'].includes(change.table)));
  assert.ok(!week.changes.some(change=>change.row.slot_id==='sl2'||change.row.id==='sl2'));
  assert.equal(week.changes.find(change=>change.table==='slot').row.rest_seconds,60);
  let current=data, changes=[];
  for(const exerciseId of ['f','e']){const result=editProgram(current,{day:data.program_day[0],action:'add',exerciseId,count:2,low:8,high:12,rest:75,scope:'program'});changes.push(...result.changes);current=withChanges(current,result.changes);}
  const added=changes.filter(change=>change.table==='slot');
  assert.deepEqual(added.map(change=>[change.row.program_day_id,change.row.position,change.row.exercise_id,change.row.rest_seconds]),[['day',1,'f',75],['later',1,'f',75],['day',2,'e',75],['later',2,'e',75]]);
  assert.ok(!changes.some(change=>['session','session_slot','set'].includes(change.table)));
  assert.equal(withChanges(data,[{table:'slot',row:{id:'sl',deleted_at:5}}]).slot.find(row=>row.id==='sl').exercise_id,'e');
});

test('a later edit after a partial swap reaches the replacement, not the original at the same position',()=>{
  const data=fixture();
  data.session_slot.push({id:'swapped',session_id:'now',exercise_id:'e',planned_exercise_id:'e',position:0,name:'Replacement'});
  const result=editWorkout(data,{day:data.program_day[0],run:{id:'r'},session:data.session[1],slot:data.session_slot[2],action:'sets',count:2,low:8,high:10});
  assert.ok(result.changes.filter(change=>change.table==='set'&&!change.row.deleted_at).every(change=>change.row.session_slot_id==='swapped'));
});

test('day names and reorder default to one week; supersets can be joined and separated without changing sets',async()=>{
  const {editProgram,withChanges}=await import('../domain/edits.js');
  const data=fixture();data.slot.push({id:'other',program_day_id:'day',position:1,exercise_id:'e'});
  const named=editProgram(data,{day:data.program_day[0],action:'title',title:' Upper A '});
  assert.deepEqual(named.changes,[{table:'program_day',row:{id:'day',title:'Upper A'}}]);
  const moved=editProgram(data,{day:data.program_day[0],slot:data.slot[0],action:'reorder',targetPosition:1});
  assert.deepEqual(moved.changes.map(c=>[c.row.id,c.row.position]),[['other',0],['sl',1]]);
  const group=editProgram(data,{day:data.program_day[0],slot:data.slot[0],action:'group'});
  assert.equal(group.changes.length,2);assert.equal(group.changes[0].row.group_kind,'superset');
  assert.equal(group.changes[0].row.group_id,group.changes[1].row.group_id);
  const separated=editProgram(withChanges(data,group.changes),{day:data.program_day[0],slot:data.slot[0],action:'ungroup'});
  assert.ok(separated.changes.every(c=>c.table==='slot'&&c.row.group_id===null));
  assert.throws(()=>editProgram(data,{day:data.program_day[0],slot:data.slot[0],action:'reorder',targetPosition:99}),/position/i);
});


test('standalone extra sets have no program event or template changes',()=>{
  const result=addExtraSets(fixture(),null,'2026-10-25',{exerciseId:'e',count:2,low:6,high:8});
  assert.equal(result.changes.find(c=>c.table==='session').row.run_id,null);
  assert.ok(result.changes.every(c=>['session','session_slot','set','setting'].includes(c.table)));
});
