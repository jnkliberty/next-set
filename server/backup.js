import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { tables } from './schema.js';
import { todayDate } from '../domain/calendar.js';

export function backupStore(store, directory, { dryRun = false, date = todayDate() } = {}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Invalid backup date');
  const destination=join(directory,`${date}.sqlite`);
  const files=existsSync(directory)?readdirSync(directory).filter(file=>/^\d{4}-\d{2}-\d{2}\.sqlite$/.test(file)).sort():[];
  const remaining=[...new Set([...files,`${date}.sqlite`])].sort();
  const remove=remaining.slice(0,Math.max(0,remaining.length-30));
  if(dryRun)return {dryRun:true,existing:files.length,wouldKeep:remaining.length-remove.length,wouldRemove:remove.length};
  if(existsSync(destination))return {created:false,kept:files.length};
  mkdirSync(directory,{recursive:true,mode:0o700});
  const temporary=`${destination}.pending-${randomUUID()}`;
  try{
    store.db.prepare('VACUUM INTO ?').run(temporary);
    const copy=new DatabaseSync(temporary,{readOnly:true});
    try{
      if(Object.values(copy.prepare('PRAGMA quick_check').get())[0]!=='ok')throw new Error('Backup integrity failed');
      for(const table of tables){
        const query=`SELECT count(*) AS n FROM "${table}"`;
        if(copy.prepare(query).get().n!==store.db.prepare(query).get().n)throw new Error('Backup counts disagree');
      }
    }finally{copy.close();}
    renameSync(temporary,destination);
    for(const file of remove)unlinkSync(join(directory,file));
    return {created:true,kept:remaining.length-remove.length};
  }catch(error){if(existsSync(temporary))unlinkSync(temporary);throw error;}
}

export function scheduleBackups(store,directory){
  const clock=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'});
  const tick=()=>{if(Number(clock.format(new Date()))>=3){try{backupStore(store,directory);}catch{console.error('Nightly backup failed.');}}};
  tick();const interval=setInterval(tick,60000);interval.unref();return ()=>clearInterval(interval);
}
