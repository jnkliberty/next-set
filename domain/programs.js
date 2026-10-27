import { live } from './model.js';
import { chooseRun, todayDate } from './calendar.js';

const ordered = rows => [...rows].sort((a,b)=>a.position-b.position);
const daysFor = (data,id) => ordered(live(data.program_day).filter(day=>day.program_id===id));

function cloneContents(data, source, target) {
  const groups=new Map(), changes=[];
  for(const slot of ordered(live(data.slot).filter(slot=>slot.program_day_id===source.id))) {
    const id=crypto.randomUUID();
    if(slot.group_id&&!groups.has(slot.group_id))groups.set(slot.group_id,crypto.randomUUID());
    const {rev,seq,device_id,updated_at,deleted_at,...fields}=slot;
    changes.push({table:'slot',row:{...fields,id,program_day_id:target.id,group_id:groups.get(slot.group_id)??null}});
    for(const set of live(data.slot_set).filter(set=>set.slot_id===slot.id)) {
      const {rev,seq,device_id,updated_at,deleted_at,...fields}=set;
      changes.push({table:'slot_set',row:{...fields,id:crypto.randomUUID(),slot_id:id}});
    }
  }
  return changes;
}

export function createProgram(data,{name,weeks,weekdays,sourceId=null,date=todayDate()}) {
  if(typeof name!=='string'||!name.trim()||name.trim().length>200)throw new Error('Enter a program name of 1 to 200 characters.');
  if(!Number.isInteger(weeks)||weeks<1||weeks>52)throw new Error('Use 1 to 52 weeks.');
  if(!Array.isArray(weekdays)||!weekdays.length||new Set(weekdays).size!==weekdays.length||weekdays.some(n=>!Number.isInteger(n)||n<0||n>6))throw new Error('Pick distinct training days.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Choose a valid start date.');
  if(sourceId&&!live(data.program).some(p=>p.id===sourceId))throw new Error('Choose an existing program to copy.');
  const id=crypto.randomUUID(), runId=crypto.randomUUID(), source=daysFor(data,sourceId), sourceWeeks=[...new Set(source.map(d=>d.week??1))];
  const changes=[{table:'program',row:{id,name:name.trim(),source:sourceId?'copy':'app'}}];
  for(let week=1;week<=weeks;week++) {
    const own=source.filter(d=>(d.week??1)===sourceWeeks[(week-1)%sourceWeeks.length]);
    weekdays.forEach((_,i)=>{
      const original=own[i], day={id:crypto.randomUUID(),program_id:id,week,day:i+1,position:(week-1)*weekdays.length+i,title:original?.title??''};
      changes.push({table:'program_day',row:day});
      if(original)changes.push(...cloneContents(data,original,day));
    });
  }
  const run={id:runId,program_id:id,start_date:date,next_position:0,status:'active'}, schedule={id:crypto.randomUUID(),run_id:runId,from_date:date,days_per_week:weekdays.length,weekdays:[...weekdays].sort(),weekly_target:weekdays.length};
  changes.push({table:'run',row:run},...chooseRun({...data,run:[...live(data.run),run],run_setting:[...live(data.run_setting),schedule]},id,date));
  return {id,runId,changes};
}

export function copyWeek(data,programId,sourceWeek,targetWeeks,{overwrite=false}={}) {
  const days=daysFor(data,programId), source=days.filter(d=>(d.week??1)===sourceWeek), targets=days.filter(d=>targetWeeks.includes(d.week??1));
  if(!source.length||!targetWeeks.length||targetWeeks.includes(sourceWeek)||targetWeeks.some(w=>!days.some(d=>(d.week??1)===w)))throw new Error('Choose a source week and different target weeks.');
  const slots=live(data.slot).filter(s=>targets.some(d=>d.id===s.program_day_id));
  if(slots.length&&!overwrite)throw new Error('Confirm replacement of the target weeks.');
  const changes=[];
  for(const slot of slots) {
    changes.push({table:'slot',row:{id:slot.id,deleted_at:Date.now()}});
    for(const set of live(data.slot_set).filter(s=>s.slot_id===slot.id))changes.push({table:'slot_set',row:{id:set.id,deleted_at:Date.now()}});
  }
  for(const target of targets) {
    const original=source.find(d=>d.day===target.day);
    changes.push({table:'program_day',row:{id:target.id,title:original?.title??''}});
    if(original)changes.push(...cloneContents(data,original,target));
  }
  return {changes};
}

export function addWeek(data,programId) {
  const days=daysFor(data,programId), last=Math.max(0,...days.map(d=>d.week??1));
  if(!days.length||last>=52)throw new Error('A program needs 1 to 52 weeks.');
  const template=days.filter(d=>(d.week??1)===last), position=Math.max(...days.map(d=>d.position))+1;
  return {changes:template.map((d,i)=>({table:'program_day',row:{id:crypto.randomUUID(),program_id:programId,week:last+1,day:d.day??i+1,position:position+i,title:''}}))};
}
