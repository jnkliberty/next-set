import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

test('phone sync keeps refused edits and recovers training rows after restore in both engines', {timeout:120000}, async t => {
  const directory=mkdtempSync(join(tmpdir(),'training-recovery-'));
  const server=spawn(process.execPath,['scripts/browser-fixture.js',join(directory,'fixture.sqlite'),'--fault'],{stdio:['ignore','pipe','inherit']});
  t.after(async()=>{server.kill('SIGTERM');if(server.exitCode==null)await once(server,'exit');rmSync(directory,{recursive:true,force:true});});
  const lines=createInterface({input:server.stdout});
  const [line]=await once(lines,'line');lines.close();
  const child=spawn(process.env.PLAYWRIGHT_PYTHON ?? 'python3',['test/sync_client.py',`http://127.0.0.1:${JSON.parse(line).port}`],{stdio:['ignore','pipe','pipe']});
  let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;});
  const [code]=await once(child,'exit');assert.equal(code,0,output);console.log(output.trim());
});
