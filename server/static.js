import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';

export function serveStatic(request, response, pathname) {
  if (request.method !== 'GET' || pathname.startsWith('/api/')) return false;
  const root = resolve('dist'), decoded = decodeURIComponent(pathname);
  if (decoded.split('/').some(part => part.startsWith('.'))) return false;
  let path = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!path.startsWith(`${root}${sep}`)) return false;
  if (!existsSync(path) && request.headers.accept?.includes('text/html')) path = resolve(root, 'index.html');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain', '.woff2': 'font/woff2' };
  if (!types[extname(path)] || !existsSync(path) || !statSync(path).isFile()) return false;
  response.writeHead(200, {
    'content-type': `${types[extname(path)]}; charset=utf-8`, 'x-content-type-options': 'nosniff',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'cross-origin-resource-policy': 'same-origin',
  });
  response.end(readFileSync(path)); return true;
}
