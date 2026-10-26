import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Julian's design rules (claude_design_guidelines.pdf): one type scale, one spacing scale, no vibe-coded styling.
const css = readFileSync('client/style.css', 'utf8') + readFileSync('client/progress.css', 'utf8');
const rules = css.replace(/:root\{[^}]*\}/, '');
const tsx = readdirSync('client').filter(f => f.endsWith('.tsx')).map(f => readFileSync(`client/${f}`, 'utf8')).join('\n');
const TYPE_SCALE = [11, 13, 15, 17, 22, 34];

test('type scale tokens are the six allowed sizes and every rule uses a token', () => {
  const tokens = [...css.matchAll(/--text-[a-z]+:(\d+)px/g)].map(m => Number(m[1]));
  assert.deepEqual(tokens.sort((a, b) => a - b), TYPE_SCALE);
  const raw = [...rules.matchAll(/font(?:-size)?:[^;}]*\d+(?:px|rem|em|pt)/g)].map(m => m[0]);
  assert.deepEqual(raw, [], 'font sizes must use var(--text-*)');
  assert.doesNotMatch(tsx, /fontSize/, 'no inline font sizes');
});

test('padding, margin and gap use the spacing scale', () => {
  const raw = [...rules.matchAll(/(?:padding|margin|gap)[a-z-]*:[^;}]*/g)].map(m => m[0])
    .filter(v => /[1-9]\d*px/.test(v.replace(/env\([^)]*\)|calc\(.*\)/g, '')));
  assert.deepEqual(raw, [], 'spacing must use var(--s*)');
});

test('no vibe-coded styling: banned fonts, gradients, glass blur, fades or emoji', () => {
  assert.doesNotMatch(css, /Inter\b|Space Grotesk|Instrument Serif/);
  assert.doesNotMatch(css, /gradient\(/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /transition:[^;}]*opacity|@keyframes/);
  assert.doesNotMatch(tsx, /\p{Emoji_Presentation}/u);
});
