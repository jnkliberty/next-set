import { live, byId } from './model.js';
import { addDays, projectCalendar, settingAt, todayDate, weekday } from './calendar.js';
import { createSession } from './session.js';

export function dayFocus(data, day) {
  const title=day?.title?.trim(), program=byId(data.program).get(day?.program_id);
  const labelTitle=program&&title?.startsWith(`${program.name} / `)?title.slice(program.name.length+3):title;
  if(labelTitle&&!/^(?:(?:week|day|workout)\s*\d+[\s/·:–-]*)+$/i.test(labelTitle))return title;
  const slots=live(data.slot).filter(slot=>slot.program_day_id===day?.id), exercises=byId(data.exercise);
  if(!slots.length)return 'No exercises yet';
  const groups=new Set();
  for(const slot of slots){
    const muscles=exercises.get(slot.exercise_id)?.primary;
    if(!muscles?.length)return 'Workout';
    for(const muscle of muscles){
      if(['lats','middle back','lower back','traps'].includes(muscle))groups.add('back');
      else if(['quadriceps','hamstrings','glutes','calves','adductors','abductors'].includes(muscle))groups.add('legs');
      else groups.add(muscle==='abdominals'?'core':muscle);
    }
  }
  const names=[...groups];
  if(names.length>3)return 'Mixed training';
  const label=new Intl.ListFormat('en',{style:'long',type:'conjunction'}).format(names);
  return label[0].toUpperCase()+label.slice(1);
}

function checkDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Choose a valid date.');
}

export function createExtraWorkout(data, run, dayId, date = todayDate()) {
  checkDate(date);
  const day = live(data.program_day).find(row=>row.id===dayId);
  if (!day || !live(data.slot).some(row=>row.program_day_id===day.id)) throw new Error('Choose a workout with exercises.');
  const result = createSession(data,day,run);
  const program = live(data.program).find(row=>row.id===day.program_id);
  for (const change of result.changes) {
    if (change.table==='session') Object.assign(change.row,{program_day_id:null,local_date:date,note:`${program?.name??'Workout'} · ${day.title||`Day ${day.day??day.position+1}`}`});
    if (change.table==='set') change.row.local_date=date;
  }
  if (run) result.changes.push({table:'run_event',row:{id:crypto.randomUUID(),run_id:run.id,kind:'added',local_date:date,position:null,session_id:result.sessionId}});
  return result;
}

function nextTrainingDate(data,run,date,today) {
  const settings=live(data.run_setting).filter(row=>row.run_id===run.id);
  for(const row of projectCalendar(data,run,addDays(date,1),addDays(date,366),today)) {
    if(!row.day&&!row.sessions?.length&&!['leave','skipped'].includes(row.state)&&settingAt(settings,row.date)?.weekdays.includes(weekday(row.date)))return row.date;
  }
  throw new Error('Set the program training days first.');
}

export function scheduleChanges(data,run,selected,action,to,today=todayDate()) {
  checkDate(selected.date);
  if(!run||!selected.day||selected.date<today)throw new Error('Choose a planned workout.');
  const day=selected.day, events=live(data.run_event).filter(row=>row.run_id===run.id);
  if(live(data.session).some(row=>row.run_id===run.id&&row.program_day_id===day.id))throw new Error('This workout has started. Open its Session sheet.');
  const changes=[];
  const event=(own,date,target,kind='moved')=>{
    const previous=events.filter(row=>row.position===own.position&&['moved','added'].includes(row.kind));
    for(const old of previous)changes.push({table:'run_event',row:{id:old.id,deleted_at:Date.now()}});
    const origin=previous.find(row=>row.kind==='moved')?.local_date??date;
    changes.push({table:'run_event',row:{id:crypto.randomUUID(),run_id:run.id,kind,local_date:origin,position:own.position,...(target?{to_date:target}:{})}});
  };
  if(action==='skip'){event(day,selected.date,null,'skipped');return changes;}
  if(action==='move') {
    checkDate(to);
    if(to<today||to<run.start_date||to===selected.date)throw new Error('Choose another future date.');
    const target=projectCalendar(data,run,to,to,today)[0];
    if(target?.day||target?.sessions?.length||target?.state==='leave')throw new Error('That date already has a workout or leave. Choose another date.');
    event(day,selected.date,to);return changes;
  }
  if(action!=='push')throw new Error('Choose a schedule change.');
  const count=live(data.program_day).filter(row=>row.program_id===run.program_id).length;
  const rows=projectCalendar(data,run,selected.date,addDays(selected.date,Math.max(366,count*7)),today).filter(row=>row.day);
  const positions=new Set(rows.map(row=>row.day.id));
  if(live(data.session).some(row=>row.run_id===run.id&&positions.has(row.program_day_id)))throw new Error('A later workout has started. Finish or delete it before pushing back.');
  for(let i=0;i<rows.length;i++)event(rows[i].day,rows[i].date,rows[i+1]?.date??nextTrainingDate(data,run,rows[i].date,today));
  return changes;
}
