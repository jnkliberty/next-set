import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { openLocal } from './db.js';
import { live, byId, trainingRows } from '../domain/model.js';
import { createSession } from '../domain/session.js';
import { createExtraWorkout, dayFocus } from '../domain/workouts.js';
import { addDays, chooseRun, projectCalendar, todayDate, weekday } from '../domain/calendar.js';
import { Logger } from './Logger';
import { Calendar, ProgramList, ProgramView } from './Planner';
import { HistorySession, SessionSheet } from './SessionSheet';
import { DayEditor, daySlots, slotSets } from './DayEditor';
import { ProgramBuilder } from './ProgramBuilder';
import { SwitchProgram, WorkoutPicker } from './WorkoutChoices';
import { Button, Row, UndoBar, setUndoHandlers, undoPending } from './ui';
import { loadKg, sessionSummary } from '../domain/metrics.js';
import { sessionFlow } from '../domain/session-flow.js';
import './style.css';

const Progress = lazy(() => import('./Progress').then(module => ({ default: module.Progress })));

function merge(data: any, rows: any[]) {
  const next = { ...data };
  for (const table of new Set(rows.map(row => row.table))) {
    const changes = rows.filter(row => row.table===table), map = new Map((next[table]||[]).map((row: Row)=>[row.id,row]));
    for (const change of changes) map.set(change.row.id,change.row);
    next[table]=[...map.values()];
  }
  return next;
}

const TABS=[
  ['workout','Home','M4 11l8-7 8 7v9h-5v-6H9v6H4z'],
  ['program','Program','M4 6h16M4 12h16M4 18h10'],
  ['calendar','Calendar','M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'],
  ['progress','Progress','M4 19h16M6 15l4-4 3 3 6-7'],
];

function App() {
  const [data,setData] = useState<any>({}), [local,setLocal] = useState<any>(null), [loaded,setLoaded] = useState(false);
  const [screen,setScreen] = useState(location.hash.slice(1)||'workout'), [sessionId,setSessionId] = useState<string|null>(null), [dayId,setDayId] = useState<string|null>(null);
  const [status,setStatus] = useState<any>({waiting:0,events:0}), [error,setError] = useState(''), [panel,setPanel] = useState<string|null>(null), [editor,setEditor] = useState<Row|null>(null);
  const [startBusy,setStartBusy] = useState(false), starting = useRef(false);
  const handle = useRef<any>(null);
  const refresh = async () => { const store=handle.current; if(!store)return; const [copy,state]=await Promise.all([store.snapshot(),store.status()]);setData(copy);setStatus((previous:any)=>({...previous,...state})); };
  useEffect(() => {
    let mounted=true, interval:any, storage:any;
    openLocal(async (event:any) => {
      if(!mounted)return;
      if(event.rows)setData((previous:any)=>merge(previous,event.rows));
      if(event.error)setError(event.error);
      if(event.online!=null)setStatus((previous:any)=>({...previous,online:event.online}));
      if(event.reload)await refresh();
      else if(handle.current)setStatus((previous:any)=>({...previous,...event}));
    }).then(async store => {
      if(!mounted){store.close();return;} storage=store; handle.current=store;setLocal(store);
      await refresh();setLoaded(true);store.sync(); interval=setInterval(()=>store.sync(),30000);
      navigator.storage?.persist?.().catch(()=>{});
    }).catch(()=>{setLoaded(true);setError('Storage did not open. Reopen the app before you log a set.');});
    const online=()=>handle.current?.sync(), hash=()=>setScreen(location.hash.slice(1)||'workout');
    window.addEventListener('online',online);window.addEventListener('hashchange',hash);
    return ()=>{mounted=false;clearInterval(interval);window.removeEventListener('online',online);window.removeEventListener('hashchange',hash);storage?.close();};
  },[]);
  useEffect(()=>{
    if(!('serviceWorker' in navigator)||!import.meta.env.PROD)return;
    // A new deploy takes over the page: reload once so the new screens show now, but never mid-workout or while Undo is offered.
    const updating=!!navigator.serviceWorker.controller, reload=()=>{if(location.hash==='#lift')window.addEventListener('hashchange',reload,{once:true});else if(undoPending())setTimeout(reload,10500);else location.reload();};
    if(updating)navigator.serviceWorker.addEventListener('controllerchange',reload,{once:true});
    navigator.serviceWorker.register('/sw.js').then(registration=>document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')registration.update().catch(()=>{});})).catch(()=>setError('Offline files did not save. Keep a connection until the next successful open.'));
  },[]);
  setUndoHandlers({refresh,fail:setError});
  async function navigate(value:string){
    try{await local?.drafts.flush();location.hash=value;setScreen(value);}
    catch{setError('These edits did not save. Keep this screen open and try again.');}
  }
  const selected=selection(data,screen,sessionId,dayId);
  const {run,session,open,day,currentSlots,activeSets,today}=selected;
  const {session:editorSession,day:editorDay}=editorContext(data,editor,open,day);

  async function chooseProgram(programId:string){
    try{
      await local.save(chooseRun(data,programId,today));setPanel(null);setDayId(null);setSessionId(null);navigate('workout');local.sync();
    }catch{setError('The program choice did not save.');}
  }
  async function start(chosen=day){
    if(starting.current||!chosen||!local)return;starting.current=true;setStartBusy(true);
    try{
      const existing=live(data.session).find((row:Row)=>row.status==='open'&&row.run_id===run?.id&&row.program_day_id===chosen.id);
      if(existing){setSessionId(existing.id);navigate('lift');return;}
      const repeated=live(data.run_event).some((row:Row)=>row.run_id===run?.id&&row.position===chosen.position&&['done','skipped'].includes(row.kind));
      const created=repeated?createExtraWorkout(data,run,chosen.id,today):createSession(data,chosen,run);if(created.changes.length<2)throw new Error('This workout has no exercises.');
      await local.save(created.changes);setDayId(null);setSessionId(created.sessionId);navigate('lift');local.sync();
    }catch(error){setError(error.message||'The workout did not start.');}finally{starting.current=false;setStartBusy(false);}
  }
  function chooseDay(id:string){setDayId(id);navigate('workout');}
  function startExtra(id:string){setSessionId(id);setDayId(null);navigate('lift');}
  function leaveSession(){setPanel(null);setSessionId(null);setDayId(null);navigate('workout');}
  const showHistory=(id:string)=>setPanel(`history:${id}`);
  if(!loaded)return <main className="app"><div className="field"><h1>Training</h1><p>Opening your training.</p></div></main>;
  return <div className={`app screen-${screen}`}><a className="skip" href="#content">Skip to content</a>
    {error&&<div className="error" role="alert"><p>{error}</p><button onClick={()=>setError('')}>Dismiss</button></div>}
    {status.error&&<button className="sync-error" role="status" onClick={()=>setPanel('session')}>{status.error}</button>}
    {screen!=='lift'&&(screen!=='program'||!run)&&<header className="app-top"><button className="status" onClick={()=>local?.sync()}><span className={`dot${status.waiting||status.online===false?' pending':''}`} aria-hidden="true"/>{status.waiting?`${status.waiting} waiting`:status.online===false?'Offline · saved here':'Saved'}</button><button className="pill" onClick={()=>setPanel('session')}>Session</button></header>}
    {status.check?.ok===false&&<button className="mismatch" onClick={()=>setPanel('session')}>Saved sets differ · Review Session</button>}
    <main id="content">
      {screen==='lift'&&session?<Logger data={data} local={local} session={session} back={()=>navigate('workout')} changed={refresh} fail={setError} openSession={()=>setPanel('session')} waiting={status.waiting} onSwap={(slot:Row)=>setEditor({step:'library',slot,session})}/>:
      !run&&screen!=='progress'?<>{open&&<div className="page-list"><Button primary onClick={()=>startExtra(open.id)}>Resume workout</Button></div>}<ProgramList data={data} choose={chooseProgram} create={()=>setPanel('new-program')} extra={()=>setPanel('extra-workout')}/></>:
      screen==='calendar'?<Calendar data={data} run={run} local={local} refresh={refresh} fail={setError} chooseDay={chooseDay} showSession={showHistory} startExtra={(id:string)=>{setSessionId(id);setDayId(null);navigate('lift');}}/>:
      screen==='program'?<ProgramView data={data} run={run} local={local} refresh={refresh} fail={setError} next={day} chooseDay={chooseDay} editDay={(own:Row)=>setEditor({mode:'program',day:own})} start={()=>start()} startBusy={startBusy} chooseProgram={()=>setPanel('switch-program')}/>:
      screen==='progress'?<Suspense fallback={<div className="field" role="status">Opening progress…</div>}><Progress data={data} showSession={showHistory}/></Suspense>:<WorkoutView data={data} selected={selected} setEditor={setEditor} start={()=>start()} startBusy={startBusy} setSessionId={setSessionId} navigate={navigate} switchProgram={()=>setPanel('switch-program')} otherDay={()=>setPanel('other-day')} addWorkout={()=>setPanel('extra-workout')}/>}
    </main>
    <Tabs screen={screen} navigate={navigate}/>
    {panel==='session'&&<SessionSheet data={data} local={local} status={status} session={session} close={()=>setPanel(null)} fail={setError} refresh={refresh} pause={leaveSession} deleted={leaveSession}/>}
    {panel==='switch-program'&&<SwitchProgram data={data} run={run} choose={chooseProgram} create={()=>setPanel('new-program')} close={()=>setPanel(null)}/>}
    {panel==='new-program'&&<ProgramBuilder data={data} local={local} refresh={refresh} fail={setError} close={()=>setPanel(null)} created={()=>{setPanel(null);setSessionId(null);setDayId(null);navigate('program');}}/>}
    {(panel==='other-day'||panel==='extra-workout')&&<WorkoutPicker data={data} run={run} local={local} refresh={refresh} fail={setError} close={()=>setPanel(null)} startDay={start} started={startExtra} extraOnly={panel==='extra-workout'}/>}
    {panel?.startsWith('history:')&&<HistorySession data={data} id={panel.slice(8)} local={local} close={()=>setPanel(null)} refresh={refresh} fail={setError}/>}
    <UndoBar/>
    {editor&&<DayEditor data={data} local={local} run={run} day={editorDay} session={editorSession} mode={editor.mode??'today'} start={editor} close={()=>setEditor(null)} fail={setError} refresh={refresh}/>}
  </div>;
}

function editorContext(data:any,editor:Row|null,open:Row|null,fallback:Row|null){
  const session=editor?.mode==='program'?null:editor?.session??open;
  const day=editor?.day??(session?.program_day_id===null?null:byId(data.program_day).get(session?.program_day_id)??fallback);
  return {session,day};
}

function Tabs({screen,navigate}:any){
  if(screen==='lift')return null;
  return <nav className="tabs" aria-label="Main">{TABS.map(([id,label,icon])=><button aria-current={screen===id?'page':undefined} key={id} onClick={()=>navigate(id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon}/></svg>{label}</button>)}</nav>;
}

function selection(data:any,screen:string,sessionId:string|null,dayId:string|null){
  const currentRunId=live(data.setting).find((row:Row)=>row.id==='current_run')?.value;
  const run=byId(data.run).get(currentRunId)||live(data.run).filter((row:Row)=>row.status==='active'||row.status==='paused').at(-1);
  const today=todayDate(), sessions=live(data.session), latestOpen=sessions.filter((row:Row)=>row.status==='open'&&(row.run_id??null)===(run?.id??null)&&(row.program_day_id!==null||row.local_date===today)).sort((a:Row,b:Row)=>b.started_at-a.started_at)[0];
  const open=latestOpen&&(!dayId||latestOpen.program_day_id===dayId)?latestOpen:null;
  const session=byId(data.session).get(sessionId)||open||(screen==='lift'?sessions.filter((row:Row)=>row.source==='app').sort((a:Row,b:Row)=>b.started_at-a.started_at)[0]:null);
  const projected=run&&screen!=='lift'?projectCalendar(data,run,today,addDays(today,366)):[];
  const omitted=new Set(live(data.run_event).filter((row:Row)=>row.run_id===run?.id&&['done','skipped'].includes(row.kind)&&row.position!=null).map((row:Row)=>row.position));
  const day=byId(data.program_day).get(dayId)||byId(data.program_day).get(open?.program_day_id)||projected.find((row:Row)=>row.day)?.day||live(data.program_day).filter((row:Row)=>row.program_id===run?.program_id&&row.position>=run.next_position&&!omitted.has(row.position)).sort((a:Row,b:Row)=>a.position-b.position)[0];
  const showing=screen==='lift'?session:open;
  const currentSlots=showing?live(data.session_slot).filter((row:Row)=>row.session_id===showing.id).sort((a:Row,b:Row)=>a.position-b.position):[];
  const activeSets=currentSlots.flatMap((slot:Row)=>live(data.set).filter((set:Row)=>set.session_slot_id===slot.id).sort((a:Row,b:Row)=>a.position-b.position));

  return {run,session,open,day,currentSlots,activeSets,today};
}

const dayLabel=(day:Row)=>`Week ${day.week??1} · Day ${day.day??day.position+1}`;
const ago=(time:number)=>{const minutes=Math.max(0,Math.round((Date.now()-time)/60000));return minutes<1?'just now':minutes<60?`${minutes} min ago`:`${Math.round(minutes/60)} h ago`;};
const weekdayName=(date:string)=>new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});

function WorkoutView({data,selected,setEditor,start,startBusy,setSessionId,navigate,switchProgram,otherDay,addWorkout}:any){
  const {run,day,open,today}=selected, paused=run.status==='paused';
  const program=byId(data.program).get(run.program_id), days=live(data.program_day).filter((row:Row)=>row.program_id===run.program_id);
  const weeks=Math.max(1,...days.map((row:Row)=>row.week??1)), finished=new Set(live(data.run_event).filter((row:Row)=>row.run_id===run.id&&row.kind==='done').map((row:Row)=>row.position)).size;
  const edit=day&&!paused&&<button className="pill" onClick={()=>setEditor({step:'day'})}>Edit day</button>;
  return (<>
    <div className="field"><p className="eyebrow">{new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'})}</p>
      <button className="switcher" onClick={switchProgram} aria-label={`${program?.name}, switch program`}><h1>{program?.name}</h1><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button>
      <p>{day?`Week ${day.week??1} of ${weeks} · `:''}{finished} of {days.length} workouts</p></div>
    <div className="page-list home-layout">
      <section className="home-workout" aria-label="Next workout">
      {paused?<div className="card"><h2>On leave</h2><p className="muted">Your targets wait for you.</p></div>:open?<ResumeCard data={data} selected={selected} edit={edit}/>:day?<NextCard data={data} day={day} edit={edit}/>:null}
      <Button onClick={addWorkout}>Add individual workout</Button>
      </section>
      <section className="home-week" aria-label="Weekly summary">
      {!paused&&<WeekStrip data={data} run={run} today={today}/>}
      {!paused&&<WeekTiles data={data} run={run} today={today}/>}
      </section>
    </div>
    <div className="cta">{open?<Button primary onClick={()=>{setSessionId(open.id);navigate('lift');}}>Resume workout</Button>:day&&!paused?<div className="split"><Button primary disabled={startBusy} onClick={start}>{startBusy?'Starting…':`Start Day ${day.day??day.position+1}`}</Button><Button onClick={otherDay}>Other day</Button></div>:<Button onClick={otherDay}>Train another day</Button>}</div>
  </>);
}

function NextCard({data,day,edit}:any){
  const slots=daySlots(data,day,null);
  const sets=slots.flatMap((slot:Row)=>slotSets(data,slot).map(()=>slot.rest_seconds??90));
  const minutes=Math.max(5,Math.round(sets.reduce((sum:number,rest:number)=>sum+rest+40,0)/300)*5);
  return <div className="card hero"><div className="hero-head"><p>{dayLabel(day)}</p>{edit}</div><strong className="hero-title">{dayFocus(data,day)}</strong>
    <small>{slots.length} exercises · {sets.length} sets · about {minutes} min</small></div>;
}

function ResumeCard({data,selected,edit}:any){
  const {open,currentSlots,activeSets}=selected, day=byId(data.program_day).get(open.program_day_id), logged=activeSets.filter((set:Row)=>set.done_at!=null);
  const last=Math.max(open.started_at,...logged.map((set:Row)=>set.done_at)), {next}=sessionFlow(currentSlots,activeSets);
  const slot=next&&currentSlots.find((row:Row)=>row.id===next.session_slot_id), number=slot&&activeSets.filter((set:Row)=>set.session_slot_id===slot.id).indexOf(next)+1;
  return <div className="card hero"><div className="hero-head"><p>In progress{day?` · ${dayLabel(day)}`:''}</p>{edit}</div><strong className="hero-title">{day?dayFocus(data,day):'Extra workout'}</strong>
    <span className="meter-bar" aria-hidden="true"><span style={{width:`${activeSets.length?logged.length/activeSets.length*100:0}%`}}/></span>
    <small>{logged.length} of {activeSets.length} sets logged · {logged.length?'last set':'started'} {ago(last)}</small>{slot&&<small>Next: {slot.name??byId(data.exercise).get(slot.exercise_id)?.name}, set {number}</small>}</div>;
}

function WeekTiles({data,run,today}:any){
  const monday=addDays(today,-((weekday(today)+6)%7)), week=projectCalendar(data,run,monday,addDays(monday,6),today);
  // A date with extras still counts when it also holds a program workout.
  const planned=week.filter((row:Row)=>!['rest','leave'].includes(row.state)&&(row.state!=='added'||row.day!=null||row.sessions?.some((own:Row)=>own.program_day_id!=null))).length, bodyweight=live(data.setting).find((row:Row)=>row.id==='bodyweight')?.value;
  const sessions=live(data.session).filter((row:Row)=>row.local_date>=monday&&row.local_date<=today);
  const done=sessions.filter((row:Row)=>row.run_id===run.id&&row.program_day_id!=null&&['done','finished_early'].includes(row.status)).length;
  const kg=Math.round(sessions.reduce((sum:number,row:Row)=>sum+sessionSummary(data,row,bodyweight).volumeKg,0));
  const exercises=byId(data.exercise), best=new Map<string,number>(); let bests=0;
  for(const row of trainingRows(data)){
    const top=Math.max(...row.sets.map((set:Row)=>loadKg(set,exercises.get(row.exercise_id),bodyweight)??0)), before=best.get(row.exercise_id);
    if(row.date>=monday&&row.date<=today&&before!=null&&top>before)bests++;
    best.set(row.exercise_id,Math.max(before??0,top));
  }
  return <><h2>This week so far · {weekdayName(monday)} to {weekdayName(today)}</h2><div className="stat-tiles">
    <div><strong>{done} of {planned}</strong><small>workouts</small></div><div><strong>{kg.toLocaleString('en-US')}</strong><small>kg lifted</small></div>
    <div><strong><span aria-hidden="true">★ </span>{bests}</strong><small>new bests</small></div></div></>;
}

const MARKS:Record<string,string>={done:'Done',added:'Extra workout',planned:'Planned',not_done:'Not done',moved:'Moved',skipped:'Skipped',leave:'Leave',rest:'Rest'};
function WeekStrip({data,run,today}:any){
  const monday=addDays(today,-((weekday(today)+6)%7)), days=projectCalendar(data,run,monday,addDays(monday,6),today);
  return <ol className="week-strip" aria-label="This week">{days.map((row:Row)=>{
    const name=new Date(`${row.date}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});
    const kind=['done','added'].includes(row.state)?'done':row.date===today?'today':['planned','not_done','moved'].includes(row.state)?'plan':'rest';
    return <li key={row.date} aria-label={`${name}: ${row.date===today?'today, ':''}${MARKS[row.state]??row.state}`}><span className={`mark ${kind}`} aria-hidden="true">{kind==='done'?'✓':kind==='rest'?'–':name[0]}</span><small aria-hidden="true">{name}</small></li>;
  })}</ol>;
}

createRoot(document.getElementById('root')!).render(<App/>);
