import { addDays, todayDate } from '../domain/calendar.js';

// All names and training numbers here are fabricated.
export function fullSizeFixture(store) {
  const put=(table,row)=>store.put(table,{rev:1,device_id:'fixture',updated_at:1,deleted_at:null,...row});
  store.db.exec('BEGIN');
  try {
    for(let i=0;i<1082;i++)put('exercise',{id:`exercise-${i}`,name:`Fixture lift ${i}`,equipment:'barbell',primary:['chest'],secondary:[],weight_basis:'total',conditioning:false});
    for(let i=0;i<11;i++)put('program',{id:`program-${i}`,name:`Fixture program ${i}`});
    for(let i=0;i<390;i++)put('program_day',{id:`day-${i}`,program_id:`program-${i%11}`,position:Math.floor(i/11),week:Math.floor(i/66)+1,day:Math.floor(i/11)%6+1,title:`Fixture day ${i}`});
    for(let i=0;i<5282;i++)put('slot',{id:`slot-${i}`,program_day_id:`day-${i%390}`,exercise_id:`exercise-${i%3}`,position:Math.floor(i/390),rest_seconds:90});
    for(let i=0;i<17500;i++)put('slot_set',{id:`plan-set-${i}`,slot_id:`slot-${i%5282}`,position:Math.floor(i/5282),type:'working',reps_min:4,reps_max:6,target_effort:8});
    for(let i=0;i<200;i++){
      const date=addDays(todayDate(),-200+i),start=Date.parse(`${date}T12:00:00Z`);
      put('session',{id:`past-${i}`,started_at:start,ended_at:start+1800000,local_date:date,timezone:'America/Chicago',source:'app',status:'done',off:false});
      for(let j=0;j<3;j++){
        const slot=`past-${i}-slot-${j}`;
        put('session_slot',{id:slot,session_id:`past-${i}`,exercise_id:`exercise-${j}`,name:`Fixture lift ${j}`,position:j});
        for(let k=0;k<9;k++)put('set',{id:`past-${i}-${j}-${k}`,session_slot_id:slot,position:k,type:'working',local_date:date,done_at:start+k*60000,weight:50,grams:50000,unit:'kg',reps:6,target_reps_min:4,target_reps_max:6,target_effort:8});
      }
    }
    for(let i=0;i<20000;i++)put('event',{id:`event-${i}`,device:'fixture',kind:'tap',time:i,detail:{action:'fixture'}});
    put('run',{id:'fixture-run',program_id:'program-0',start_date:todayDate(),next_position:0,status:'active'});
    put('run_setting',{id:'fixture-schedule',run_id:'fixture-run',from_date:todayDate(),days_per_week:7,weekdays:[0,1,2,3,4,5,6],weekly_target:7});
    put('setting',{id:'current_run',value:'fixture-run'});
    store.db.exec('COMMIT');
  } catch(error) { store.db.exec('ROLLBACK');throw error; }
}
