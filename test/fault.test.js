import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const runs=process.env.FAULT_RUNS||'200';
test(`P4: ${runs} fault runs per engine preserve acknowledged sets and drain every answered operation`, {timeout:900000}, async t=>{
  const directory=mkdtempSync(join(tmpdir(),'training-fault-'));
  const server=spawn(process.execPath,['scripts/browser-fixture.js',join(directory,'fixture.sqlite'),'--fault'],{stdio:['ignore','pipe','pipe']});
  const lines=createInterface({input:server.stdout});
  const [line]=await once(lines,'line');lines.close();const {port}=JSON.parse(line);
  const child=spawn(process.env.PLAYWRIGHT_PYTHON ?? 'python3',['test/fault_ui.py',`http://127.0.0.1:${port}`,runs],{stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill('SIGTERM');server.kill('SIGTERM');if(server.exitCode==null)await once(server,'exit');rmSync(directory,{recursive:true,force:true});});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});child.stderr.on('data',chunk=>{output+=chunk;});
  const [code]=await once(child,'exit');assert.equal(code,0,output);
});
