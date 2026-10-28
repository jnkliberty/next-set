import React, { useState } from 'react';
import { live, byId } from '../domain/model.js';
import { addDays, copyProgram, projectCalendar, settingAt, todayDate, weekday } from '../domain/calendar.js';
import { WorkoutPicker, ScheduleSheet, workoutLabel } from './WorkoutChoices';
import { WeekGrid } from './WeekGrid';
import { dayFocus } from '../domain/workouts.js';
import { Button, Row, Sheet, dateText, saveUndoable, Icon } from './ui';

export function ProgramList({ data, choose, create, extra }: any) {
  const days = byId(data.program_day), usable = new Set(live(data.slot).map((slot: Row) => days.get(slot.program_day_id)?.program_id));
  return <><div className="field"><p>Your training</p><h1>Choose a program.</h1></div><div className="page-list">{live(data.program).map((program: Row) => <button className="program-choice" key={program.id} onClick={() => choose(program.id)}><strong>{program.name}</strong><span>{live(data.program_day).filter((day: Row) => day.program_id === program.id).length} workouts <Icon name="open"/></span></button>)}<Button onClick={create}>New program</Button><Button onClick={extra}>Add individual workout</Button>{!usable.size && <p>Your programs appear after the first connection to the server. After that, they work offline.</p>}</div></>;
}

export function ProgramView({ data, run, next, chooseDay, editDay, start, startBusy, chooseProgram, local, refresh, fail }: any) {
  const [options, setOptions] = useState(false), [name, setName] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1,2,3,4,5,6]);
  const schedule = settingAt(live(data.run_setting).filter((row:Row)=>row.run_id===run.id),todayDate());
  const daysPerWeek = weekdays.length;
  const program = byId(data.program).get(run.program_id);
  const days = live(data.program_day).filter((day: Row) => day.program_id === run.program_id).sort((a: Row, b: Row) => a.position - b.position);
  const weeks = Map.groupBy(days, (day: Row) => day.week ?? 1);
  const current = next ?? days.find((day: Row) => day.position === run.next_position), lastWeek = Math.max(1, ...days.map((day: Row) => day.week ?? 1));
  const done = new Set(live(data.run_event).filter((row: Row) => row.run_id === run.id && row.kind === 'done').map((row: Row) => row.position));
  const dayRow = (day: Row) => { const label = day.title || `Day ${day.day ?? day.position + 1}`;
    return <div className="day-item" key={day.id}><button className="list-row day-row" onClick={() => chooseDay(day.id)}><span className="row-main"><strong>{dayFocus(data,day)}</strong><small>Day {day.day??day.position+1} · {live(data.slot).filter((slot:Row)=>slot.program_day_id===day.id).length} exercises</small></span>{done.has(day.position) ? <span className="tag done"><Icon name="check"/>Done</span> : day.id === current?.id ? <span className="tag next">Next</span> : null}</button><button className="pill" aria-label={`Edit ${label}`} onClick={() => editDay(day)}>Edit</button></div>; };
  const action = async (fn: () => Promise<any>) => { try { await fn(); setOptions(false); refresh(); local.sync(); } catch (error) { fail(error.message || 'The program change did not save.'); } };
  async function pause() {
    const today = todayDate(), paused = run.status === 'paused';
    const changes: any[] = [{ table: 'run', row: { id: run.id, status: paused ? 'active' : 'paused' } }];
    if (!paused) changes.push({ table: 'run_event', row: { id: crypto.randomUUID(), run_id: run.id, kind: 'leave', local_date: today } });
    else for (const event of live(data.run_event).filter((row: Row) => row.run_id === run.id && row.kind === 'leave' && !row.to_date)) {
      changes.push({ table: 'run_event', row: event.local_date === today ? { id: event.id, deleted_at: Date.now() } : { id: event.id, to_date: addDays(today, -1) } });
    }
    await local.save(changes);
  }
  const weekdayNames = (schedule?.weekdays ?? []).map((n: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n]).join(' ');
  return <><div className="field"><div className="top"><span>Program</span><button onClick={() => { setName(`${program?.name} copy`); setWeekdays(schedule?.weekdays??[1,2,3,4,5,6]); setOptions(true); }}>Options</button></div><h1>{program?.name}</h1><p>{run.status === 'paused' ? 'On leave' : weekdayNames} · started {dateText(run.start_date)}</p></div>
    <div className="page-list program-layout">
      <div className="card progress-card"><div><strong>Week {current?.week ?? lastWeek} of {lastWeek}</strong><span className="muted">{done.size} of {days.length} workouts</span></div><span className="meter-bar" aria-hidden="true"><span style={{ width: `${done.size / (days.length || 1) * 100}%` }}/></span></div>
      <section className="program-current">{current && <><h2>This week</h2><div className="card list">{(weeks.get(current.week ?? 1) ?? []).map(dayRow)}</div></>}</section>
      <section className="program-weeks"><details><summary className="week-row">Edit weeks</summary><WeekGrid data={data} program={program} local={local} refresh={refresh} fail={fail} editDay={editDay}/></details>{weeks.size>1&&<h2>Other weeks</h2>}
      {[...weeks].filter(([week]: [any, any]) => !current || week !== (current.week ?? 1)).map(([week, own]: [any, any]) => <details key={week}><summary className="week-row"><strong>Week {week}</strong><span>{own.length} days</span></summary>{own.map(dayRow)}</details>)}
      <Button onClick={chooseProgram}>Change program</Button></section></div>
    {current && run.status !== 'paused' && <div className="cta"><Button primary disabled={startBusy} onClick={start}>{startBusy ? 'Starting…' : `Start Day ${current.day ?? current.position + 1}`}</Button></div>}
    {options && <Sheet title="Program options" close={() => setOptions(false)}><Button onClick={() => action(pause)}>{run.status === 'paused' ? 'Return from leave' : 'Pause for leave'}</Button><form onSubmit={event => { event.preventDefault(); action(() => { if(!weekdays.length)throw new Error('Pick at least one training day.'); return local.save([{ table: 'run_setting', row: { id: schedule?.from_date===todayDate()?schedule.id:crypto.randomUUID(), run_id: run.id, from_date: todayDate(), days_per_week: daysPerWeek, weekdays, weekly_target: daysPerWeek } }]); }); }}><p>Training days per week: {daysPerWeek}</p><fieldset><legend>Usual training days</legend><div className="weekday-controls">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => <button type="button" aria-pressed={weekdays.includes(i)} key={day} onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter(n => n !== i) : [...weekdays, i].sort())}>{day}</button>)}</div></fieldset><Button primary type="submit">Save schedule from today</Button></form><label>Copy name<input value={name} onChange={event => setName(event.target.value)} maxLength={200}/></label><Button onClick={() => action(async () => { if (!name.trim()) throw new Error('Enter a copy name.'); const copy = copyProgram(data, run.program_id, name.trim()); await local.save(copy.changes); })}>Copy program</Button></Sheet>}
  </>;
}

export function Calendar({ data, run, chooseDay, local, refresh, fail, showSession, startExtra }: any) {
  const [extraDate,setExtraDate] = useState<string|null>(null), [change,setChange]=useState<any>(null);
  const today = todayDate(), [month, setMonth] = useState(today.slice(0, 7)), [selected, setSelected] = useState<Row | null>(null);
  const first = `${month}-01`, next = new Date(`${first}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1), rows = projectCalendar(data, run, first, last, today);
  const gaps = Array.from({ length: weekday(first) }, (_, i) => <span key={`gap${i}`}/>);
  function shiftMonth(by: number) { const date = new Date(`${first}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + by); setMonth(date.toISOString().slice(0, 7)); }
  function editSchedule(initial:string){setChange({selected,initial});setSelected(null);}
  return <div className="calendar-page"><div className="month-head"><h1>{new Date(`${first}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h1><button aria-label="Previous month" onClick={() => shiftMonth(-1)}><Icon name="back"/></button><button aria-label="Next month" onClick={() => shiftMonth(1)}><Icon name="next"/></button></div><div className="calendar-grid weekday-labels">{['S','M','T','W','T','F','S'].map((day, i) => <span key={i}>{day}</span>)}</div><div className="calendar-grid">{gaps}{rows.map((row: Row) => <button key={row.date} className={`calendar-day ${row.state} ${row.date === today ? 'today' : ''}`} aria-label={`${row.date}: ${row.state.replace('_', ' ')}`} onClick={() => setSelected(row)}><span>{Number(row.date.slice(-2))}</span>{row.state === 'added' && <sup><Icon name="plus"/></sup>}{row.state === 'moved' && <sup><Icon name="open"/></sup>}</button>)}</div><details className="calendar-legend"><summary>What the marks mean</summary><p>Square: done. Plus: extra workout. Dot: not done. Slash: skipped. Arrow: moved. Outline: today.</p></details>
    {selected && <Sheet title={dateText(selected.date)} close={() => setSelected(null)}><p>{selected.day?workoutLabel(selected.day):selected.state.replace('_',' ')}</p>
      {selected.sessions?.map((session:Row)=><Button key={session.id} onClick={()=>{setSelected(null);if(session.status==='open')startExtra(session.id);else showSession(session.id);}}>{session.program_day_id===null?'Extra workout':'Workout'} · {session.status==='open'?'Resume':'See sets'}</Button>)}
      {selected.day&&<Button primary onClick={()=>{chooseDay(selected.day.id);setSelected(null);}}>See workout</Button>}
      {selected.day&&selected.date>=today&&!selected.sessions?.some((own:Row)=>own.program_day_id===selected.day.id)&&<><Button onClick={()=>editSchedule('move')}>Move to another date</Button><Button onClick={()=>editSchedule('skip')}>Skip or push back</Button></>}
      <Button onClick={()=>{setExtraDate(selected.date);setSelected(null);}}>Add workout</Button>
    </Sheet>}
    {change&&<ScheduleSheet {...change} data={data} run={run} local={local} refresh={refresh} fail={fail} close={()=>setChange(null)}/>}
    {extraDate&&<WorkoutPicker data={data} local={local} run={run} date={extraDate} extraOnly refresh={refresh} fail={fail} close={()=>setExtraDate(null)} started={(id:string)=>{if(extraDate===today)startExtra(id);}}/>}
  </div>;
}
