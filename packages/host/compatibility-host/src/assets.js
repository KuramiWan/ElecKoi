import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export const ASSETS_BASE_URL = '/eleckoi/compat/';
const entryAssets = new Set(['tavern-shared.global.js', 'tavern-runtime.global.js', 'zod-module.js', 'lodash-module.js']);
const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm' };

/** Serve only presentation libraries and the pure format runtime. */
export function createAuthorAssetHandler(assetsDirectory) {
  const root = resolve(assetsDirectory || dirname(require.resolve('@eleckoi/compatibility-tavern-shared/runtime')));
  return async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    let path;
    try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(ASSETS_BASE_URL.length)); }
    catch { response.writeHead(400); response.end(); return; }
    let target;
    if (path === 'client/runtime.js') target = fileURLToPath(new URL('../web/runtime.js', import.meta.url));
    else if (path.startsWith('assets/')) {
      const resource = path.slice(7);
      if (entryAssets.has(resource) || resource.startsWith('assets/')) target = resolve(root, resource);
      if (target && !target.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
      if (target && resource.startsWith('assets/') && !target.startsWith(resolve(root, 'assets') + sep)) { response.writeHead(403); response.end(); return; }
    }
    let content;
    if (target) {
      try { content = await readFile(target); }
      catch (error) { if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw error; }
    }
    if (content === undefined) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Resource is unavailable'); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  };
}
