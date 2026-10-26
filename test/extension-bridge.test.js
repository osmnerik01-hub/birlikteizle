import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

for (const asynchronous of [false, true]) test(`bridge handles ${asynchronous ? 'rejected' : 'synchronously invalidated'} extension context`, async () => {
  let handler, calls = 0; const replies = [];
  const window = { addEventListener: (_, fn) => handler = fn, postMessage: message => replies.push(message) };
  const origin = 'https://your-firebase-project.web.app';
  vm.runInNewContext(await readFile('extension/bridge.js', 'utf8'), { window, top: window, location: { origin }, chrome: { runtime: { id: "test-extension",
    onMessage: { addListener() {} }, sendMessage() { calls++; const error = new Error('Extension context invalidated.'); if (asynchronous) return Promise.reject(error); throw error; }
  } } });
  for (const requestId of ['first', 'second']) await handler({ source: window, origin, data: { source: 'birlikte-app', action: 'PING', requestId } });
  assert.equal(calls, 1, 'stale context is not called repeatedly');
  assert.equal(replies.length, 2);
  assert.ok(replies.every(reply => reply.result.ok === false && reply.result.error.includes('yenile')));
});

test('bridge never calls an invalidated runtime with a missing extension id', async () => {
  let handler, calls = 0; const replies = [];
  const window = { addEventListener: (_, fn) => handler = fn, postMessage: message => replies.push(message) };
  const origin = 'https://your-firebase-project.web.app';
  const runtime = { id: 'installed', onMessage: { addListener() {} }, sendMessage() { calls++; throw new Error('must not call'); } };
  vm.runInNewContext(await readFile('extension/bridge.js', 'utf8'), { window, top: window, location: { origin }, chrome: { runtime } });
  runtime.id = undefined;
  for (const requestId of ['first', 'second']) await handler({ source: window, origin, data: { source: 'birlikte-app', action: 'PING', requestId } });
  assert.equal(calls, 0);
  assert.equal(replies.length, 2);
  assert.ok(replies.every(reply => reply.result.ok === false));
});
