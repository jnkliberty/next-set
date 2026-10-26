import React, { useState } from 'react';
import { byId, exerciseIdentity, live, trainingRows } from '../domain/model.js';
import { addExtraSets, editWorkout } from '../domain/edits.js';
import { Button, Row, Sheet } from './ui';

export function WorkoutEditor({ data, local, run, day, session, state, close, refresh, fail, created }: any) {
  const target=state.slot, initial=currentSets(data,target);
  const [step,setStep]=useState(state.action==='add'?'search':'menu'), [action,setAction]=useState(state.action), [query,setQuery]=useState('');
  const [exerciseId,setExercise]=useState<string|null>(null), [count,setCount]=useState(initial.count), [low,setLow]=useState(initial.low), [high,setHigh]=useState(initial.high), [busy,setBusy]=useState(false);
  const [type,setType]=useState(initial.type),[seconds,setSeconds]=useState(initial.seconds);
  const exercises=byId(data.exercise);
  const currentMuscles=new Set(live(data.slot).filter((slot:Row)=>slot.program_day_id===day?.id).flatMap((slot:Row)=>exercises.get(slot.exercise_id)?.primary||[]));
  const since=Date.now()-56*86400000, freq=new Map();
  for(const row of trainingRows(data).filter((row:Row)=>row.started_at>=since))freq.set(row.exercise_id,(freq.get(row.exercise_id)||0)+row.sets.length);
  const all=[...exercises.values()].filter((row:Row)=>exerciseIdentity(exercises,row.id)===row.id);
  const results=all.filter((row:Row)=>!query||row.name.toLowerCase().includes(query.toLowerCase())).sort((a:Row,b:Row)=>{
    const score=(row:Row)=>(freq.get(row.id)||0)+(row.primary.some((muscle:string)=>currentMuscles.has(muscle))?100000:0);
    return score(b)-score(a)||a.name.localeCompare(b.name);
  }).slice(0,query?12:5);
  async function apply(scope:string){
    if(busy)return;setBusy(true);
    try{const edit={day,run,session,slot:target,action,exerciseId,count,low,high,type,seconds,scope};const result=state.extraDate?addExtraSets(data,run,state.extraDate,edit):editWorkout(data,edit);await local.save(result.changes);await refresh();local.sync();close();if(state.extraDate)created?.(result.sessionId);}catch(error){fail(error.message||'The workout edit did not save.');}finally{setBusy(false);}
  }
  function chooseAction(value:string){setAction(value);setStep(value==='swap'?'search':value==='remove'||value==='move'?'reach':'configure');}
  return <Sheet title={step==='reach'?'Where does this change go?':step==='configure'?'Sets and reps':step==='search'?(action==='swap'?'Swap exercise':'Add exercise'):target?.name??exercises.get(target?.exercise_id)?.name??'Edit workout'} close={close}>
    {step==='menu'?<>{[['swap','Swap exercise'],['sets','Change sets'],['move','Move earlier'],['remove','Remove exercise']].map(([key,label])=><Button key={key} onClick={()=>chooseAction(key)}>{label}</Button>)}<label>Program note<textarea defaultValue={target?.pinned_note??''} onBlur={event=>{const table=target.session_id?'session_slot':'slot';local.save([{table,row:{id:target.id,pinned_note:event.target.value}}]).then(()=>local.sync()).catch(()=>fail('The note did not save.'));}}/></label></>:
    step==='search'?<><label>Find an exercise<input type="search" autoFocus placeholder="Exercise name" value={query} onChange={event=>setQuery(event.target.value)}/></label>{results.map((exercise:Row)=><button className="list-row" key={exercise.id} onClick={()=>{setExercise(exercise.id);setStep(action==='swap'?'reach':'configure');}}><strong>{exercise.name}</strong><span>{exercise.equipment}</span></button>)}{!results.length&&<p>No matching exercise. Try a shorter name.</p>}</>:
    step==='configure'?<><h3>{exerciseId?exercises.get(exerciseId)?.name:target?.name}</h3><Stepper label="Sets" value={count} set={setCount} min={1} max={8}/><label>Set type<select value={type} onChange={event=>setType(event.target.value)}>{[['working','Working'],['warmup','Warm-up'],['drop','Drop set'],['rest_pause','Rest-pause'],['failure','To failure'],['timed','Timed interval']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{type==='timed'&&<label>Seconds<input type="number" min="1" max="9999" value={seconds} onChange={event=>setSeconds(Number(event.target.value))}/></label>}<Stepper label="Minimum reps" value={low} set={setLow} min={1} max={high}/><Stepper label="Maximum reps" value={high} set={setHigh} min={low} max={99}/><Button primary onClick={()=>setStep('reach')}>Next</Button></>:
    <>{(state.extraDate||session?.program_day_id===null?[['today','Today only']]:[['today','Today only'],['future',`Day ${day?.day??1} from now on`],['program',`Day ${day?.day??1} in every week`]]).map(([scope,label])=><Button key={scope} disabled={busy} onClick={()=>apply(scope)}>{label}</Button>)}</>}
  </Sheet>;
}

function currentSets(data:any,slot:Row){
  const sets=live(slot?.session_id?data.set:data.slot_set).filter((row:Row)=>slot&&(slot.session_id?row.session_slot_id:row.slot_id)===slot.id).sort((a:Row,b:Row)=>a.position-b.position), first=sets[0];
  return {count:sets.length||2,low:first?.reps_min??first?.target_reps_min??4,high:first?.reps_max??first?.target_reps_max??6,type:first?.type??'working',seconds:first?.seconds??first?.target_seconds??30};
}

function Stepper({label,value,set,min,max}:any){
  return <div className="config-stepper" role="group" aria-label={label}><span>{label}</span><button aria-label={`Decrease ${label.toLowerCase()}`} disabled={value<=min} onClick={()=>set(Math.max(min,value-1))}>−</button><output>{value}</output><button aria-label={`Increase ${label.toLowerCase()}`} disabled={value>=max} onClick={()=>set(Math.min(max,value+1))}>+</button></div>;
}
