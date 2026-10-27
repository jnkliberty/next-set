import React, { useState } from 'react';
import { live } from '../domain/model.js';
import { addWeek, copyWeek } from '../domain/programs.js';
import { Button, Row, Sheet, saveUndoable } from './ui';
import './program-editing.css';

export function WeekGrid({ data, program, local, refresh, fail, editDay }: any) {
  const days=live(data.program_day).filter((d:Row)=>d.program_id===program.id).sort((a:Row,b:Row)=>a.position-b.position);
  const weeks=[...new Set<number>(days.map((d:Row)=>d.week??1))], numbers=[...new Set<number>(days.map((d:Row)=>d.day??1))];
  const [copy,setCopy]=useState(false),[source,setSource]=useState(weeks[0]??1),[targets,setTargets]=useState<number[]>([]),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
  const slots=live(data.slot), hasContent=targets.some(week=>days.some((d:Row)=>(d.week??1)===week&&slots.some((s:Row)=>s.program_day_id===d.id)));
  async function save(result:()=>any,text:string) {
    if(busy)return;setBusy(true);
    try{await saveUndoable(local,result().changes,text);await refresh();local.sync();setCopy(false);setConfirm(false);setTargets([]);}catch(error){fail(error.message||'The week did not save.');}finally{setBusy(false);}
  }
  return <section className="week-grid-section" aria-label="Week grid"><p className="muted">Exercises per day</p>
    <div className="week-grid-scroll"><table className="week-grid"><thead><tr><th scope="col">Week</th>{numbers.map(n=><th key={n} scope="col">D{n}</th>)}</tr></thead><tbody>{weeks.map(week=><tr key={week}><th scope="row">W{week}</th>{numbers.map(n=>{
      const day=days.find((d:Row)=>(d.week??1)===week&&(d.day??1)===n), count=slots.filter((s:Row)=>s.program_day_id===day?.id).length;
      return <td key={n}>{day?<button className={count?'filled':''} onClick={()=>editDay(day)} aria-label={`Edit Week ${week}, Day ${n}${day.title?`, ${day.title}`:''}: ${count} exercises`}>{count||'–'}</button>:<span>–</span>}</td>;
    })}</tr>)}</tbody></table></div>
    <Button onClick={()=>{setSource(weeks[0]);setTargets([]);setConfirm(false);setCopy(true);}} disabled={weeks.length<2}>Copy a week</Button>
    <Button disabled={busy||weeks.length>=52} onClick={()=>save(()=>addWeek(data,program.id),'Week added')}>Add a week</Button>
    {copy&&<Sheet title="Copy a week" close={()=>setCopy(false)}><label>Copy from<select value={source} onChange={e=>{setSource(Number(e.target.value));setTargets(targets.filter(w=>w!==Number(e.target.value)));setConfirm(false);}}>{weeks.map(week=><option key={week} value={week}>Week {week}</option>)}</select></label><fieldset className="copy-targets"><legend>Copy to</legend>{weeks.filter(w=>w!==source).map(week=><label key={week}><input type="checkbox" checked={targets.includes(week)} onChange={()=>{setTargets(targets.includes(week)?targets.filter(w=>w!==week):[...targets,week]);setConfirm(false);}}/>Week {week}</label>)}</fieldset>
      {hasContent&&<label className="overwrite-check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Replace exercises in the selected weeks</label>}
      <Button primary disabled={busy||!targets.length||(hasContent&&!confirm)} onClick={()=>save(()=>copyWeek(data,program.id,source,targets,{overwrite:confirm}),`Week ${source} copied`)}>Copy Week {source}</Button>
    </Sheet>}
  </section>;
}
