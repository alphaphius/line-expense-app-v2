import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.resolve(root, '..', 'line-expense-app');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('GitHub Pages HTML preserves every V1 screen element id', async () => {
  const [v1, v2] = await Promise.all([readFile(path.join(sourceRoot, 'Index.html'), 'utf8'), read('frontend/index.html')]);
  const ids = source => new Set(Array.from(source.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  assert.deepEqual(ids(v2), ids(v1));
  assert.doesNotMatch(v2, /<\?(?:=|!=)/);
  assert.doesNotMatch(v2, /cdn\.tailwindcss\.com/);
});

test('frontend calls the same business functions as V1 through the API adapter', async () => {
  const [v1, v2] = await Promise.all([readFile(path.join(sourceRoot, 'Scripts.html'), 'utf8'), read('frontend/app.js')]);
  const calls = source => Array.from(source.matchAll(/(?:gas|callWithRequestId)\('([A-Za-z0-9_]+)'/g), match => match[1]).sort();
  assert.deepEqual(calls(v2), calls(v1));
  assert.match(v2, /window\.V2Api\.call/);
  assert.doesNotMatch(v2, /google\.script\.run/);
});

test('browser scripts parse and image compression is bounded', async () => {
  for (const file of ['frontend/config.js', 'frontend/api.js', 'frontend/image-optimizer.js', 'frontend/app.js', 'frontend/pwa.js', 'frontend/service-worker.js']) {
    const source = await read(file);
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  }
  const optimizer = await read('frontend/image-optimizer.js');
  assert.match(optimizer, /maxLongEdge:\s*1800/);
  assert.match(optimizer, /targetBytes:\s*1200\s*\*\s*1024/);
  assert.match(optimizer, /Math\.min\(2, list\.length\)/);
});

test('Apps Script source parses and exposes only allowlisted frontend actions', async () => {
  const files = (await readdir(path.join(root, 'apps-script'))).filter(file => file.endsWith('.gs')).sort();
  const source = (await Promise.all(files.map(file => read(`apps-script/${file}`)))).join('\n');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'apps-script-v2.gs' }));
  assert.match(source, /function apiActionHandler_/);
  assert.match(source, /ACTION_NOT_ALLOWED/);
  assert.match(source, /function requireApiSession_/);
  assert.match(source, /function getLineContextId_/);
  assert.match(source, /source_context_id/);
  assert.doesNotMatch(source, /APP_CONFIG\.WEB_APP_URL/);
  assert.doesNotMatch(source, /DATABASE_ACCESS_PASSWORD_SHA256/);
});

test('repository contains no live V1 identifiers or embedded credentials', async () => {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'tests'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(root);
  const source = (await Promise.all(files.map(file => readFile(file, 'utf8').catch(() => '')))).join('\n');
  assert.doesNotMatch(source, /13wQin-j-zUdPYJTTSOtwJN01okmoEhFFWwnTDDgKYc7B9C-fLse3CKAQ/);
  assert.doesNotMatch(source, /10iEWHITGi7vKg09TXEGzp7GgBRMLzzE6ANwgEehlDKU/);
  assert.doesNotMatch(source, /AKfycbymQD7snXoRZQbORrsljbKZvfeDi3kw0A9v8NEXYjYAyMhWAHjCXQyAcWM3GCxHx3Ij/);
  assert.doesNotMatch(source, /2009457348-SwkPdMG3/);
});

test('service worker caches only same-origin static GET assets', async () => {
  const worker = await read('frontend/service-worker.js');
  assert.match(worker, /event\.request\.method !== 'GET'/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(worker, /script\.google\.com/);
});
