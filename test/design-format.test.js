import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('design checker accepts CSS whitespace and rejects type, spacing and style violations', t => {
  const directory = mkdtempSync(join(tmpdir(), 'training-design-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'client'));
  writeFileSync(join(directory, 'client/progress.css'), readFileSync('client/progress.css'));
  const css = readFileSync('client/style.css', 'utf8')
    .replace(':root{', ':root \n{')
    .replace(/(--text-[a-z]+):/g, '$1 : \n');
  const cases = [
    { name: 'equivalent whitespace', extra: '.fixture { font-size \t: var(--text-body); padding : var(--s3); transition : color 1s }', pass: true },
    { name: 'wrong type scale', extra: ':root { --text-extra : 19px }', message: 'type scale tokens' },
    { name: 'raw font size', extra: '.fixture { font-size : 18px }', message: 'font sizes must use' },
    { name: 'raw spacing', extra: '.fixture { padding : 9px }', message: 'spacing must use' },
    { name: 'opacity transition', extra: '.fixture { transition : opacity 1s }', message: 'no vibe-coded styling' },
  ];
  for (const { name, extra, pass, message } of cases) {
    writeFileSync(join(directory, 'client/style.css'), css + extra);
    const result = spawnSync(process.execPath, ['--test', resolve('test/design.test.js')], { cwd: directory, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, pass ? 0 : 1, `${name}: ${output}`);
    if (!pass) assert.match(output, new RegExp(message), name);
  }
});
