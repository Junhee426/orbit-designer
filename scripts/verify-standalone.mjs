// Check the files actually published to Render, including Linux case sensitivity.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publish = resolve(root, 'standalone');
async function checkPath(target) {
  const path = relative(publish, target);
  assert(path && !path.startsWith('..') && !path.includes(':'), `Asset leaves publish directory: ${target}`);
  let parent = publish;
  for (const part of path.split(sep)) {
    assert((await readdir(parent)).includes(part), `Missing asset or case mismatch: ${path}`);
    parent = resolve(parent, part);
  }
  const info = await stat(target);
  assert(info.isDirectory() || info.size > 0, `Empty asset: ${path}`);
}
const required = [
  'index.html', 'app.js', 'engine.js', 'analysis.js', 'analysis-worker.js', 'scenario.js',
  'viewer.js', 'geometry.js', 'rendering.js', 'boot.js', 'styles.css', 'integrated.css',
  'catalog.json', 'boundaries.geojson', 'world.json', 'earth.jpg', 'example.tle', 'build.json',
  'vendor/satellite.es.js', 'vendor/satellite-LICENSE.md', 'vendor/cesium-LICENSE.md',
  'vendor/cesium/Cesium.js', 'vendor/cesium/Widgets/widgets.css',
  'vendor/cesium/Workers', 'vendor/cesium/Assets', 'vendor/cesium/ThirdParty',
];
for (const name of required) await checkPath(resolve(publish, name));
let references = 0;
for (const name of await readdir(publish)) {
  if (!/\.(?:html|js|css)$/.test(name)) continue;
  const source = await readFile(resolve(publish, name), 'utf8');
  const refs = [...source.matchAll(/["'`](\.\.?\/[^"'`\s$]+)["'`]/g)].map(m => m[1]);
  for (const ref of refs) {
    await checkPath(resolve(dirname(resolve(publish, name)), ref.split(/[?#]/)[0]));
    references++;
  }
  // This app has no backend endpoints; a local path regression should fail the build.
  assert(!/\bfetch\(\s*["'`]\/api\//.test(source), `Backend dependency in ${name}`);
}
for (const name of ['catalog.json', 'boundaries.geojson', 'world.json', 'build.json']) {
  JSON.parse(await readFile(resolve(publish, name), 'utf8'));
}
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const build = JSON.parse(await readFile(resolve(publish, 'build.json'), 'utf8'));
assert.equal(build.version, pkg.version);
assert.deepEqual(build.dependencies, pkg.dependencies);
const blueprint = await readFile(resolve(root, 'render.yaml'), 'utf8');
assert.match(blueprint, /runtime: static/);
assert.match(blueprint, /staticPublishPath: \.\/standalone/);
assert(!/startCommand:|healthCheckPath:|runtime: docker/.test(blueprint), 'Root Blueprint must be a static site');
assert.equal(await readFile(resolve(publish, 'render.yaml'), 'utf8'), blueprint, 'Blueprint copies differ');
console.log(`Static deployment verified: ${required.length} required paths, ${references} relative references, model ${build.version}.`);
