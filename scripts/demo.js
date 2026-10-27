import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('Use --dry-run or no arguments');
if (process.argv.includes('--dry-run')) {
  console.log('Demo preview: invented workouts in a new temporary database; loopback listener; cleanup on exit. No persistent data is opened.');
} else {
  const directory = mkdtempSync(join(tmpdir(), 'next-set-demo-'));
  const child = spawn(process.execPath, ['scripts/browser-fixture.js', join(directory, 'demo.sqlite'), '--progress=populated'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  lines.once('line', line => { const { port } = JSON.parse(line); console.log(`Sample workouts: http://127.0.0.1:${port}/#progress`); });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  child.once('exit', code => { lines.close(); rmSync(directory, { recursive: true, force: true }); process.exitCode = code ?? 0; });
  child.once('error', error => { rmSync(directory, { recursive: true, force: true }); console.error(error.message); process.exitCode = 1; });
}
