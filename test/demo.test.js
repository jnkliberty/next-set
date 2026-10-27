import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('disposable demo previews without writing, serves sample charts, then removes its own database', { timeout: 20000 }, async t => {
  const directories = () => readdirSync(tmpdir()).filter(name => name.startsWith('next-set-demo-')).sort();
  const before = directories(), preview = spawnSync(process.execPath, ['scripts/demo.js', '--dry-run'], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(directories(), before);
  const child = spawn(process.execPath, ['scripts/demo.js'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => { if (child.exitCode == null) { child.kill('SIGTERM'); await once(child, 'exit'); } });
  const lines = createInterface({ input: child.stdout }), [line] = await once(lines, 'line'); lines.close();
  const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; assert.ok(url, line);
  const response = await fetch(url); assert.equal(response.status, 200); assert.match(await response.text(), /type="module"/);
  const notices = await fetch(`${url}/dependency-licenses.txt`);
  assert.equal(notices.status, 200); assert.match(notices.headers.get('content-type'), /^text\/plain/);
  assert.match(await notices.text(), /recharts 3\.10\.1/);
  const exit = once(child, 'exit'); child.kill('SIGTERM'); const [code] = await exit;
  assert.equal(code, 0); assert.deepEqual(directories(), before);
});
