import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../standalone/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
const server = http.createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const path = resolve(root, '.' + name);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !(await stat(path)).isFile()) throw Error('missing');
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.PORT || 8080);
server.listen(port, '127.0.0.1', () => console.log(`K-LEO browser app: http://127.0.0.1:${port} (static files only)`));
