import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Home Screen PNG is 180 square and belongs to the manifest, document and offline shell',()=>{
  const png=readFileSync('public/apple-touch-icon.png');
  assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),180);assert.equal(png.readUInt32BE(20),180);
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  assert.ok(manifest.icons.some(icon=>icon.src==='/apple-touch-icon.png'&&icon.sizes==='180x180'&&icon.type==='image/png'));
  assert.match(readFileSync('index.html','utf8'),/rel="apple-touch-icon"[^>]*href="\/apple-touch-icon.png"/);
  assert.ok(readFileSync('dist/sw.js','utf8').includes('/apple-touch-icon.png'));
});
