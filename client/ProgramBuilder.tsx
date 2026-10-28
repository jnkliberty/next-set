import React, { useState } from 'react';
import { live } from '../domain/model.js';
import { createProgram } from '../domain/programs.js';
import { Button, Row, Sheet, saveUndoable, Icon } from './ui';
import './program-editing.css';

export function ProgramBuilder({ data, local, refresh, fail, close, created }: any) {
  const [name,setName]=useState(''), [weeks,setWeeks]=useState(6), [weekdays,setWeekdays]=useState<number[]>([1,2,4,5]);
  const [sourceId,setSource]=useState(''), [busy,setBusy]=useState(false);
  const programs=live(data.program), labels=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const sourceDays=live(data.program_day).filter((d:Row)=>d.program_id===sourceId), firstWeek=Math.min(...sourceDays.map((d:Row)=>d.week??1));
  const copied=sourceDays.filter((d:Row)=>(d.week??1)===firstWeek).length;
  const dayOrder=[1,2,3,4,5,6,0], selected=dayOrder.filter(day=>weekdays.includes(day));
  async function save(event:React.FormEvent) {
    event.preventDefault(); if(busy)return;setBusy(true);
    try {
      const result=createProgram(data,{name,weeks,weekdays:selected,sourceId:sourceId||null});
      await saveUndoable(local,result.changes,`${name.trim()} created`);await refresh();local.sync();created(result.id,result.runId);
    }catch(error){fail(error.message||'The program did not save.');}finally{setBusy(false);}
  }
  return <Sheet title="New program" close={close}><form onSubmit={save}>
    <label>Name<input autoComplete="off" value={name} onChange={e=>setName(e.target.value)} maxLength={200} required/></label>
    <div className="config-stepper" role="group" aria-label="Weeks"><span>Weeks</span><button type="button" aria-label="Decrease weeks" disabled={weeks<=1} onClick={()=>setWeeks(weeks-1)}><Icon name="minus"/></button><output>{weeks}</output><button type="button" aria-label="Increase weeks" disabled={weeks>=52} onClick={()=>setWeeks(weeks+1)}><Icon name="plus"/></button></div>
    <fieldset className="builder-days"><legend>Training days · {weekdays.length} per week</legend><div className="weekday-controls">{dayOrder.map(day=><button type="button" key={day} aria-pressed={weekdays.includes(day)} onClick={()=>setWeekdays(weekdays.includes(day)?weekdays.filter(d=>d!==day):[...weekdays,day])}>{labels[day]}{weekdays.includes(day)&&<Icon name="check"/>}</button>)}</div></fieldset>
    <fieldset className="builder-source"><legend>Start from</legend><label className="source-choice"><input type="radio" name="source" checked={!sourceId} onChange={()=>setSource('')}/>Empty days</label>{programs.map((p:Row)=><label className="source-choice" key={p.id}><input type="radio" name="source" checked={sourceId===p.id} onChange={()=>setSource(p.id)}/>Copy {p.name}</label>)}</fieldset>
    {sourceId&&<p className="copy-mapping">{copied?`Days 1 to ${Math.min(copied,selected.length)} fill ${selected.slice(0,copied).map(d=>labels[d]).join(', ')}.`:'All days start empty.'}{selected.length>copied&&copied>0?` ${selected.slice(copied).map(d=>labels[d]).join(', ')} ${selected.length-copied===1?'starts':'start'} empty.`:''}{copied>selected.length?' Remaining source days are not copied.':''}</p>}
    <div className="sheet-cta"><Button primary type="submit" disabled={busy||!name.trim()||!weekdays.length}>{busy?'Creating…':`Create ${weeks} weeks × ${weekdays.length} days`}</Button></div>
  </form></Sheet>;
}
