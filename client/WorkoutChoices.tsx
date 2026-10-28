import React, { useState } from 'react';
import { byId, live } from '../domain/model.js';
import { addDays, projectCalendar, todayDate } from '../domain/calendar.js';
import { withChanges } from '../domain/edits.js';
import { createExtraWorkout, scheduleChanges, dayFocus } from '../domain/workouts.js';
import { WorkoutEditor } from './WorkoutEditor';
import { Button, Row, Sheet, dateText, saveUndoable, Icon } from './ui';
import './workout-choices.css';

export const workoutLabel = (day: Row) => day.title || `Week ${day.week ?? 1} · Day ${day.day ?? day.position + 1}`;

export function SwitchProgram({data,run,choose,create,close}:any) {
  const [busy,setBusy]=useState(false);
  return <Sheet title="Switch program" close={close}><div className="card list">
    {live(data.program).map((program:Row)=>{
      const own=live(data.run).find((row:Row)=>row.program_id===program.id&&row.status!=='done');
      const count=live(data.program_day).filter((row:Row)=>row.program_id===program.id).length;
      return <button className="list-row" key={program.id} disabled={busy} onClick={async()=>{setBusy(true);try{await choose(program.id);}finally{setBusy(false);}}}><span className="row-main"><strong>{program.name}</strong><small>{count} workouts · {own?.status==='paused'?'On leave':own?'In progress':'Not started'}</small></span>{program.id===run?.program_id&&<span className="current"><Icon name="check"/>Current</span>}</button>;
    })}</div><Button onClick={create}>New program</Button></Sheet>;
}

export function WorkoutPicker({data,run,local,refresh,fail,close,startDay,started,date=todayDate(),extraOnly=false}:any) {
  const [programId,setProgramId]=useState(run?.program_id??live(data.program)[0]?.id??''), [dayId,setDayId]=useState('');
  const [custom,setCustom]=useState(false),[busy,setBusy]=useState(false),[extra,setExtra]=useState(extraOnly);
  // Empty program days cannot start, so only days with exercises are offered.
  const filled=new Set(live(data.slot).map((slot:Row)=>slot.program_day_id)), programs=live(data.program);
  const days=live(data.program_day).filter((day:Row)=>day.program_id===programId&&filled.has(day.id)).sort((a:Row,b:Row)=>a.position-b.position);
  const day=days.find((own:Row)=>own.id===dayId), exercises=byId(data.exercise);
  const done=new Set(live(data.run_event).filter((row:Row)=>row.run_id===run?.id&&['done','skipped'].includes(row.kind)).map((row:Row)=>row.position));
  const borrowed=extraOnly||extra||!run||run.status==='paused'||programId!==run.program_id||done.has(day?.position);
  const slots=live(data.slot).filter((slot:Row)=>slot.program_day_id===day?.id).sort((a:Row,b:Row)=>a.position-b.position);
  async function start() {
    if(!day||busy)return;setBusy(true);
    try {
      if(!borrowed){await startDay(day);close();return;}
      const result=createExtraWorkout(data,run,day.id,date);
      await saveUndoable(local,result.changes,'Extra workout added');await refresh();local.sync();close();started(result.sessionId);
    } catch(error){fail(error.message||'The workout did not save.');}finally{setBusy(false);}
  }
  if(custom)return <WorkoutEditor data={data} local={local} run={run} day={null} session={null} state={{action:'add',extraDate:date}} refresh={refresh} fail={fail} close={close} created={started}/>;
  return <Sheet title={extraOnly?'Add workout':'Train another day'} close={close}>
    <Button primary={!days.length} onClick={()=>setCustom(true)}>Choose exercises</Button><p className="muted">Log any exercises without a program.</p>
    {programs.length>0&&<><h3>Or repeat a program day</h3><label>Program<select value={programId} onChange={event=>{setProgramId(event.target.value);setDayId('');}}>{programs.map((row:Row)=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {!days.length&&<p className="muted">This program has no days with exercises yet.</p>}</>}
    {days.length>0&&<div className="card list">{days.map((own:Row)=><button className="list-row" key={own.id} aria-pressed={own.id===dayId} onClick={()=>setDayId(own.id)}><span className="row-main"><strong>{dayFocus(data,own)}</strong><small>Week {own.week??1} · Day {own.day??own.position+1}</small></span><span>{own.id===dayId?<><Icon name="check"/>Selected</>:programId===run?.program_id&&done.has(own.position)?'Done':<Icon name="next"/>}</span></button>)}</div>}
    {day&&<><h3>{borrowed?'Extra workout':`Train ${workoutLabel(day)}`}</h3><p>{slots.length} exercises · {dateText(date)}</p>
      {!extraOnly&&programId===run?.program_id&&!done.has(day.position)&&<label className="checkbox"><span>Keep this as an extra workout</span><input type="checkbox" checked={extra} onChange={event=>setExtra(event.target.checked)}/></label>}
      <p>{borrowed?'The program and its dates stay unchanged.':'Other unfinished workouts stay next. Nothing is skipped.'}</p>
      <Button primary disabled={busy||!slots.length} onClick={start}>{busy?'Saving…':extraOnly?'Add workout':`Start ${borrowed?'extra workout':`Day ${day.day??day.position+1}`}`}</Button></>}
  </Sheet>;
}

function Preview({rows}:any) {
  return <div className="card list">{rows.map((row:Row)=><div className="list-row" key={row.date}><span>{dateText(row.date)}</span><strong>{row.day?workoutLabel(row.day):row.state==='skipped'?'Skipped':'Rest'}</strong></div>)}</div>;
}

export function ScheduleSheet({data,run,selected,initial,local,refresh,fail,close}:any) {
  const [action,setAction]=useState(initial),[date,setDate]=useState(addDays(selected.date,1)),[busy,setBusy]=useState(false);
  const today=todayDate(), end=addDays(selected.date,28);
  let changes:any[]=[],error='';
  try{changes=scheduleChanges(data,run,selected,action,date,today);}catch(cause){error=cause.message;}
  const after=error?[]:projectCalendar(withChanges(data,changes),run,selected.date,date>end?addDays(date,7):end,today);
  const shown=after.filter((row:Row)=>row.date===selected.date||row.date===date||row.day).slice(0,4);
  const warning=action==='move'&&after.some((row:Row)=>row.day&&(row.date===addDays(date,-1)||row.date===addDays(date,1)));
  async function save(){
    if(busy||error)return;setBusy(true);
    try{await saveUndoable(local,changes,action==='skip'?'Workout skipped':action==='push'?'Workouts pushed back':'Workout moved');await refresh();local.sync();close();}catch(cause){fail(cause.message||'The schedule did not save.');}finally{setBusy(false);}
  }
  return <Sheet title={action==='move'?'Move workout':'Skip or push back'} close={close}><p>{workoutLabel(selected.day)} · {dateText(selected.date)}</p>
    {action==='move'?<><div className="date-strip" aria-label="New date">{Array.from({length:5},(_,i)=>addDays(selected.date,i+1)).map(value=><button key={value} aria-pressed={date===value} onClick={()=>setDate(value)}>{dateText(value)}</button>)}</div><label>Choose another date<input type="date" min={today} value={date} onChange={event=>setDate(event.target.value)}/></label></>:
      <div className="schedule-options">{[['skip','Skip','This workout is removed. Later dates stay unchanged.'],['push','Push back','Every workout stays. Later workouts move one training slot.']].map(([value,label,description])=><button key={value} aria-pressed={action===value} onClick={()=>setAction(value)}><strong>{action===value&&<Icon name="check"/>}{label}</strong><span>{description}</span></button>)}</div>}
    <h3>What changes</h3>{error?<p role="status">{error}</p>:<Preview rows={shown}/>}{warning&&<p>These dates create back-to-back training days.</p>}
    <Button primary disabled={busy||!!error} onClick={save}>{action==='move'?`Move to ${dateText(date)}`:action==='skip'?'Skip this workout':'Push everything back'}</Button>
  </Sheet>;
}
