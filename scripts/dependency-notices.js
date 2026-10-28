import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const sections = [];
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path || metadata.dev) continue;
  const files = readdirSync(path, { recursive: true }).filter(file => /^licen[cs]e(?:[.-].*)?$/i.test(basename(file)));
  if (!files.length) throw new Error(`Missing license file: ${path}`);
  const name = path.split('node_modules/').at(-1);
  sections.push(`${name} ${metadata.version}\n${files.map(file => readFileSync(join(path, file), 'utf8')).join('\n')}`);
  if (name === 'victory-vendor') sections.push(readFileSync('licenses/victory-vendor.txt', 'utf8'));
}
sections.push(`Geist font 1.7.2 (public/fonts)\n${readFileSync('licenses/geist-OFL.txt', 'utf8')}`);
const notices = `Dependency licenses\n\n${sections.join('\n\n--------------------\n\n')}`.replace(/\r\n/g, '\n').trimEnd() + '\n';
if (!process.argv.includes('--dry-run')) writeFileSync('public/dependency-licenses.txt', notices);
console.log(`${process.argv.includes('--dry-run') ? 'Preview' : 'Wrote'} ${sections.length} dependency license sections.`);
