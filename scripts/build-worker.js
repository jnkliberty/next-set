import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const files = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png', '/dependency-licenses.txt', '/fonts/Geist-Variable.woff2', ...readdirSync('dist/assets').map(file => `/assets/${file}`)];
const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
const source = readFileSync('client/sw.js', 'utf8').replace('__CACHE__', `training-shell-${hash}`).replace('__SHELL__', JSON.stringify(files));
writeFileSync('dist/sw.js', source);
console.log(`Offline shell: ${files.length} files.`);
