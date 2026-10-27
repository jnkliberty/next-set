import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as workouts from '../domain/workouts.js';
import { projectCalendar } from '../domain/calendar.js';
import { withChanges } from '../domain/edits.js';
import { finishChanges, startChanges } from '../domain/session.js';

const run = { id:'r',program_id:'p',start_date:'2026-01-01',next_position:0,status:'active' };
function fixture() {
  return { program:[{id:'p',name:'Example'},{id:'other',name:'Other example'}],run:[run],
    program_day:[0,1,2].map(position=>({id:`d${position}`,program_id:'p',position})).concat({id:'borrow',program_id:'other',position:0}),
    exercise:[{id:'e',name:'Example press',equipment:'barbell',primary:['chest'],secondary:[]}],
    slot:[{id:'sl',program_day_id:'borrow',exercise_id:'e',position:0}],
    slot_set:[{id:'ss',slot_id:'sl',position:0,type:'working',reps_min:4,reps_max:6}],
    run_setting:[{id:'rs',run_id:'r',from_date:'2026-01-01',weekdays:[0,1,2,3,4,5,6]}],
    session:[],session_slot:[],set:[],setting:[],run_event:[] };
}
const dates = data => projectCalendar(data,run,'2026-01-01','2026-01-05','2026-01-01').map(row=>row.day?.id??null);

test('day focus uses explicit names or complete muscle metadata, never exercise-name guesses',()=>{
  const data=fixture(), day={id:'borrow',title:'Day 1'};
  assert.equal(workouts.dayFocus(data,day),'Chest');
  assert.equal(workouts.dayFocus(data,{...day,program_id:'p',title:'Example / Week 1 / Day 1'}),'Chest');
  data.exercise.push({id:'row',name:'Made-up row',primary:['lats','middle back']},{id:'extension',name:'Made-up extension',primary:['triceps']});
  data.slot=[{id:'a',program_day_id:'borrow',exercise_id:'row'},{id:'b',program_day_id:'borrow',exercise_id:'extension'}];
  assert.equal(workouts.dayFocus(data,day),'Back and triceps');
  assert.equal(workouts.dayFocus(data,{...day,title:'Push'}),'Push');
  data.slot.push({id:'unknown',program_day_id:'borrow',exercise_id:'missing'});
  assert.equal(workouts.dayFocus(data,day),'Workout');
  data.slot.at(-1).deleted_at=1;
  assert.equal(workouts.dayFocus(data,day),'Back and triceps');
  assert.equal(workouts.dayFocus(data,{id:'empty'}),'No exercises yet');
});

test('borrowed workout snapshots targets without changing either program or advancing the run',()=>{
  const data=fixture(), before=structuredClone(data);
  const result=workouts.createExtraWorkout(data,run,'borrow','2026-01-02');
  const next=withChanges(data,result.changes), session=next.session[0];
  assert.equal(session.program_day_id,null);
  assert.equal(next.set[0].target_reps_min,4);
  assert.equal(next.set[0].local_date,'2026-01-02');
  const loggedLater = withChanges(next, startChanges(next, session, Date.parse('2026-01-04T18:00:00Z')));
  assert.equal(loggedLater.session[0].local_date, '2026-01-02', 'Calendar-selected date survives later data entry');
  assert.equal(loggedLater.set[0].local_date, '2026-01-02');
  assert.deepEqual(dates(next),['d0','d1','d2',null,null]);
  assert.deepEqual(finishChanges(next,session).map(change=>change.table),['session']);
  assert.deepEqual(data,before);
  assert.equal(workouts.createExtraWorkout(data,null,'borrow','2026-01-02').changes.some(change=>change.table==='run_event'),false);
  assert.throws(()=>workouts.createExtraWorkout(data,run,'missing','2026-01-02'),/workout/i);
  assert.throws(()=>workouts.createExtraWorkout(data,run,'borrow','2026-02-30'),/date/i);
});

test('skip omits one workout without shifting the remaining dates; push back retains every workout',()=>{
  const data=fixture();
  const skipped=withChanges(data,workouts.scheduleChanges(data,run,{date:'2026-01-02',day:data.program_day[1]},'skip',null,'2026-01-01'));
  assert.deepEqual(dates(skipped),['d0',null,'d2',null,null]);
  const pushed=withChanges(data,workouts.scheduleChanges(data,run,{date:'2026-01-02',day:data.program_day[1]},'push',null,'2026-01-01'));
  assert.deepEqual(dates(pushed),['d0',null,'d1','d2',null]);
  data.run_event.push({id:'leave',run_id:'r',kind:'leave',local_date:'2026-01-04',to_date:'2026-01-04'});
  const afterLeave=withChanges(data,workouts.scheduleChanges(data,run,{date:'2026-01-02',day:data.program_day[1]},'push',null,'2026-01-01'));
  assert.deepEqual(dates(afterLeave),['d0',null,'d1',null,'d2']);
  data.session.push({id:'open',run_id:'r',program_day_id:'d2',status:'open',local_date:'2026-01-03'});
  assert.throws(()=>workouts.scheduleChanges(data,run,{date:'2026-01-02',day:data.program_day[1]},'push',null,'2026-01-01'),/started/i);
});

test('moving one workout preserves later dates and refuses an occupied target',()=>{
  const data=fixture(), selected={date:'2026-01-02',day:data.program_day[1]};
  const moved=withChanges(data,workouts.scheduleChanges(data,run,selected,'move','2026-01-05','2026-01-01'));
  assert.deepEqual(dates(moved),['d0',null,'d2',null,'d1']);
  assert.throws(()=>workouts.scheduleChanges(data,run,selected,'move','2026-01-03','2026-01-01'),/already/i);
  const movedAgain=withChanges(moved,workouts.scheduleChanges(moved,run,{date:'2026-01-05',day:data.program_day[1]},'move','2026-01-04','2026-01-01'));
  assert.deepEqual(dates(movedAgain),['d0',null,'d2','d1',null]);
  const removed=withChanges(moved,workouts.scheduleChanges(moved,run,{date:'2026-01-05',day:data.program_day[1]},'skip',null,'2026-01-01'));
  assert.deepEqual(dates(removed),['d0',null,'d2',null,null]);
});

test('an open workout remains visible on a rest date',()=>{
  const data=fixture();data.run_setting[0].weekdays=[1];
  data.session.push({id:'open',run_id:'r',program_day_id:'d0',local_date:'2026-01-01',status:'open'});
  const [day]=projectCalendar(data,run,'2026-01-01','2026-01-01','2026-01-01');
  assert.equal(day.day.id,'d0');assert.equal(day.sessions[0].id,'open');
});

test('missed reservations return to the remaining workouts after their date or leave',()=>{
  const data=fixture();
  data.run_event.push({id:'move',run_id:'r',kind:'moved',position:0,local_date:'2026-01-01',to_date:'2026-01-02'});
  const projected=projectCalendar(data,run,'2026-01-03','2026-01-05','2026-01-03');
  assert.deepEqual(projected.map(row=>row.day?.id),['d0','d1','d2']);
  data.run_event.push({id:'leave',run_id:'r',kind:'leave',local_date:'2026-01-02',to_date:'2026-01-03'});
  assert.deepEqual(projectCalendar(data,run,'2026-01-04','2026-01-06','2026-01-02').map(row=>row.day?.id),['d0','d1','d2']);
  const base=fixture(), pushed=withChanges(base,workouts.scheduleChanges(base,run,{date:'2026-01-01',day:base.program_day[0]},'push',null,'2026-01-01'));
  assert.deepEqual(projectCalendar(pushed,run,'2026-01-03','2026-01-05','2026-01-03').map(row=>row.day?.id),['d1','d2','d0']);
});

test('a reservation stays visible when another workout was skipped at its origin',()=>{
  let data=fixture();
  data=withChanges(data,workouts.scheduleChanges(data,run,{date:'2026-01-02',day:data.program_day[1]},'move','2026-01-05','2026-01-01'));
  data=withChanges(data,workouts.scheduleChanges(data,run,{date:'2026-01-01',day:data.program_day[0]},'move','2026-01-02','2026-01-01'));
  data=withChanges(data,workouts.scheduleChanges(data,run,{date:'2026-01-05',day:data.program_day[1]},'skip',null,'2026-01-01'));
  assert.deepEqual(dates(data),[null,'d0','d2',null,null]);
  let skipped=fixture();
  skipped=withChanges(skipped,workouts.scheduleChanges(skipped,run,{date:'2026-01-01',day:skipped.program_day[0]},'skip',null,'2026-01-01'));
  skipped=withChanges(skipped,workouts.scheduleChanges(skipped,run,{date:'2026-01-02',day:skipped.program_day[1]},'move','2026-01-01','2026-01-01'));
  assert.deepEqual(dates(skipped),['d1',null,'d2',null,null]);
});

test('finishing today leaves tomorrow next and skipping it preserves later dates',()=>{
  let data=fixture();
  data.session.push({id:'finished',run_id:'r',program_day_id:'d0',status:'done',local_date:'2026-01-01'});
  data=withChanges(data,finishChanges(data,data.session[0]));
  const own=data.run[0];
  assert.deepEqual(projectCalendar(data,own,'2026-01-01','2026-01-04','2026-01-01').map(row=>row.day?.id??null),[null,'d1','d2',null]);
  data=withChanges(data,workouts.scheduleChanges(data,own,{date:'2026-01-02',day:data.program_day[1]},'skip',null,'2026-01-01'));
  assert.deepEqual(projectCalendar(data,own,'2026-01-01','2026-01-04','2026-01-01').map(row=>row.day?.id??null),[null,null,'d2',null]);
});
