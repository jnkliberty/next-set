import { DatabaseSync } from 'node:sqlite';
import { backupStore } from '../server/backup.js';
const dryRun=process.argv.includes('--dry-run');
if(process.argv.slice(2).some(arg=>arg!=='--dry-run'))throw new Error('Use --dry-run or no arguments');
const db=new DatabaseSync(process.env.DB_PATH||'data/workout.sqlite',{readOnly:true});
try{console.log(JSON.stringify(backupStore({db},process.env.BACKUP_DIR||'data/backups',{dryRun})));}
catch{console.error('Backup stopped. No training rows are printed.');process.exitCode=1;}
finally{db.close();}
