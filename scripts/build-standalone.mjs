import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = resolve(root, 'standalone');
await mkdir(resolve(app, 'vendor'), { recursive: true });
await cp(resolve(root, 'node_modules/cesium/Build/Cesium'), resolve(app, 'vendor/cesium'), { recursive: true });
await cp(resolve(root, 'node_modules/satellite.js/dist/satellite.es.js'), resolve(app, 'vendor/satellite.es.js'));
await cp(resolve(root, 'node_modules/satellite.js/LICENSE.md'), resolve(app, 'vendor/satellite-LICENSE.md'));
await cp(resolve(root, 'node_modules/cesium/LICENSE.md'), resolve(app, 'vendor/cesium-LICENSE.md'));
for (const name of await readdir(app)) if (name.endsWith('.js')) {
  const r = spawnSync(process.execPath, ['--check', resolve(app, name)], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr);
}
const files = await readdir(app);
for (const required of ['index.html', 'app.js', 'engine.js', 'analysis-worker.js', 'catalog.json']) if (!files.includes(required)) throw Error(`Missing ${required}`);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await writeFile(resolve(app, 'build.json'), JSON.stringify({ version: pkg.version, dependencies: pkg.dependencies }, null, 2) + '\n');
console.log('Standalone ready. Publish standalone/ or run npm start. No calculation server or runtime CDN.');
