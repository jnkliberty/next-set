import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { backupStore } from '../server/backup.js';
import { tables } from '../server/schema.js';
import { exportHashes } from '../domain/export.js';

test('backup preview writes nothing; vacuum copies restore correctly and retention keeps thirty files',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'training-backup-')),source=new Store(join(directory,'source.sqlite'));
  t.after(()=>{source.close();rmSync(directory,{recursive:true,force:true});});
  source.apply({id:'fixture-op',table:'setting',row:{id:'bodyweight',value:80000,rev:1,device_id:'fixture',updated_at:1,deleted_at:null}});
  const destination=join(directory,'backups');
  assert.equal(backupStore(source,destination,{dryRun:true,date:'2026-01-01'}).wouldKeep,1);
  assert.ok(!readdirSync(directory).includes('backups'));
  for(let day=1;day<=31;day++)backupStore(source,destination,{date:`2026-01-${String(day).padStart(2,'0')}`});
  const files=readdirSync(destination);assert.equal(files.length,30);assert.ok(!files.includes('2026-01-01.sqlite'));
  const restored=new Store(join(destination,'2026-01-31.sqlite'));
  try{
    const snapshot=store=>Object.fromEntries(tables.map(table=>[table,store.rows(table,true)]));
    assert.deepEqual(await exportHashes(snapshot(restored)),await exportHashes(snapshot(source)));
  }finally{restored.close();}
  assert.equal(backupStore(source,destination,{date:'2026-01-31'}).created,false);
});
