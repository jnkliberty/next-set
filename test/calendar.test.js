import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseRun, projectCalendar, copyProgram, settingAt } from '../domain/calendar.js';

function example() {
  return { program: [{ id: 'p', name: 'Made-up program' }], program_day: [0, 1, 2].map(position => ({ id: `d${position}`, program_id: 'p', position, day: position + 1, week: 1 })),
    slot: [{ id: 'sl', program_day_id: 'd0', position: 0, exercise_id: 'e' }], slot_set: [{ id: 'ss', slot_id: 'sl', position: 0, type: 'working', reps_min: 4, reps_max: 6 }],
    run_setting: [{ id: 'rs', run_id: 'r', from_date: '2026-01-01', weekdays: [0, 1, 2, 3, 4, 5, 6], weekly_target: 7 }], run_event: [], session: [] };
}
const run = { id: 'r', program_id: 'p', start_date: '2026-01-01', next_position: 0, status: 'active' };

test('switching runs stops the old target and choosing it again restores its weekdays',()=>{
  const data=example();data.run=[run,{...run,id:'b',program_id:'b'}];data.setting=[{id:'current_run',value:'r'}];
  data.run_setting[0]={...data.run_setting[0],from_date:'2026-10-24',days_per_week:2,weekdays:[1,4],weekly_target:2};
  const switched=chooseRun(data,'b','2026-10-24');
  assert.ok(switched.some(change=>change.table==='run_setting'&&change.row.run_id==='r'&&change.row.weekly_target===0));
  for(const {table,row} of switched){data[table]??=[];const i=data[table].findIndex(old=>old.id===row.id);if(i<0)data[table].push(row);else data[table][i]={...data[table][i],...row,rev:(data[table][i].rev??0)+1};}
  const resumed=chooseRun(data,'p','2026-10-25').find(change=>change.table==='run_setting'&&change.row.run_id==='r').row;
  assert.equal(resumed.weekly_target,2);assert.deepEqual(resumed.weekdays,[1,4]);
  assert.equal(settingAt([resumed],'2026-10-25').days_per_week,2);
});

test('skip shifts pending workouts, completed days stay done and Pause creates no missed days', () => {
  const data = example();
  data.run_event.push({ id: 'skip', run_id: 'r', kind: 'skipped', local_date: '2026-01-02' });
  data.session.push({ id: 'done', run_id: 'r', status: 'done', local_date: '2026-01-01' });
  let calendar = projectCalendar(data, run, '2026-01-01', '2026-01-04', '2026-01-02');
  assert.equal(calendar[0].state, 'done');
  assert.equal(calendar[1].state, 'skipped');
  assert.equal(calendar[2].day.id, 'd0');
  data.run_event.push({ id: 'leave', run_id: 'r', kind: 'leave', local_date: '2026-01-02' });
  calendar = projectCalendar(data, { ...run, status: 'paused' }, '2026-01-01', '2026-01-04', '2026-01-04');
  assert.deepEqual(calendar.map(row => row.state), ['done', 'leave', 'leave', 'leave']);
});

test('dated weekdays preserve earlier missed days; moves retain the original day and its targets', () => {
  const data = example();
  data.run_setting.push({ id: 'later', run_id: 'r', from_date: '2026-01-03', weekdays: [0], rev: 1 });
  data.run_event.push({ id: 'move', run_id: 'r', kind: 'moved', local_date: '2026-01-04', to_date: '2026-01-05', position: 0 });
  const calendar = projectCalendar(data, run, '2026-01-01', '2026-01-05', '2026-01-04');
  assert.equal(calendar[0].state, 'not_done');
  assert.equal(calendar[3].state, 'moved');
  assert.equal(calendar[4].day.id, 'd0');
  assert.equal(data.slot_set[0].reps_min, 4);
  const copied = copyProgram(data, 'p', 'Copy');
  assert.equal(copied.changes.filter(row => row.table === 'program_day').length, 3);
  assert.deepEqual(copied.changes.filter(row => row.table === 'slot_set').map(row => [row.row.reps_min, row.row.reps_max]), [[4, 6]]);
});

test('extras on a planned date keep that program workout', () => {
  const data = example();
  data.run_event.push({ id: 'extra', run_id: 'r', kind: 'added', local_date: '2026-01-02', position: null });
  data.session.push({ id: 'x', run_id: 'r', program_day_id: null, status: 'done', local_date: '2026-01-02' });
  const [day] = projectCalendar(data, run, '2026-01-02', '2026-01-02', '2026-01-02');
  assert.equal(day.state, 'added');
  assert.equal(day.day.id, 'd0');
});
