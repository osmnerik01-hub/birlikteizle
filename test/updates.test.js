import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { stampAssets } from '../scripts/stamp-assets.mjs';

test('asset versions cover HTML and nested imports, are stable, and change with deployed content', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bi-assets-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<script src="/app.js"></script><script src="/update-client.js" data-app-build=""></script><link href="/style.css"><img src="https://example.com/logo.svg">');
    await writeFile(path.join(directory, 'app.js'), "import '/helper.js'; import('/helper.js');");
    await writeFile(path.join(directory, 'helper.js'), 'export const value = 1;');
    await writeFile(path.join(directory, 'update-client.js'), '');
    await writeFile(path.join(directory, 'style.css'), 'body{color:red}');
    const first = await stampAssets(directory);
    assert.equal(await stampAssets(directory), first, 'unchanged builds keep the same cache key');
    assert.match(await readFile(path.join(directory, 'app.js'), 'utf8'), new RegExp('/helper.js\\?v=' + first));
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.ok(html.includes(`data-app-build="${first}"`));
    assert.ok(html.includes('https://example.com/logo.svg"'));
    await writeFile(path.join(directory, 'style.css'), 'body{color:blue}');
    const next = await stampAssets(directory);
    assert.notEqual(next, first);
    assert.equal((JSON.parse(await readFile(path.join(directory, 'build-info.json'), 'utf8'))).version, next);
    assert.equal(await stampAssets(directory), next);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function updateFixture() {
  const nodes = [], handlers = {}, stored = new Map([['identity', 'keep']]), input = { value: 'unsent draft' };
  const window = new EventTarget(); let reloads = 0, version = 'bbbbbbbbbbbbbbbb';
  const document = { hidden: false, body: { append: node => nodes.push(node) },
    querySelector: selector => selector === 'script[data-app-build]' ? { dataset: { appBuild: 'aaaaaaaaaaaaaaaa' } } : selector === '#message' ? input : null,
    addEventListener: (event, fn) => handlers[event] = fn,
    createElement: tag => ({ tag, children: [], setAttribute() {}, append(...children) { this.children.push(...children); } }) };
  const context = { document, window, Event, location: { pathname: '/room/test', reload: () => reloads++ },
    sessionStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    setInterval: fn => handlers.poll = fn,
    fetch: async (url, options) => { assert.equal(options.cache, 'no-store'); return { ok: true, json: async () => ({ version }) }; } };
  vm.runInNewContext(await readFile('public/update-client.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, handlers, stored, input, window, get reloads() { return reloads; } };
}

test('new release shows one notice without auto-reloading, preserves draft and leaves identity intact', async () => {
  const fixture = await updateFixture();
  assert.equal(fixture.nodes.length, 1); assert.equal(fixture.reloads, 0);
  await fixture.handlers.poll(); assert.equal(fixture.nodes.length, 1);
  fixture.nodes[0].children[1].onclick();
  assert.equal(fixture.reloads, 1);
  assert.equal(fixture.stored.get('bi-update-draft:/room/test'), 'unsent draft');
  assert.equal(fixture.stored.get('identity'), 'keep');
});

test('an active chat send can prevent update reload until queued messages finish', async () => {
  const fixture = await updateFixture();
  fixture.window.addEventListener('app-before-update', event => event.preventDefault());
  fixture.nodes[0].children[1].onclick();
  assert.equal(fixture.reloads, 0);
});
