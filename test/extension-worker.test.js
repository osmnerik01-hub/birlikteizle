import test from 'node:test';
import assert from 'node:assert/strict';

test('extension binds only room-opened tabs, forwards commands to the detected iframe, and stops on revocation', async () => {
  const listeners = {}, calls = []; let bindings = {}, permitted = true, nextTab = 40;
  const event = name => ({ addListener: fn => listeners[name] = fn });
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: '0.4.0' }), getURL: path => `chrome-extension://test/${path}`, onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
    storage: { session: { get: async () => ({ bindings: structuredClone(bindings) }), set: async value => { bindings = structuredClone(value.bindings); } } },
    permissions: { contains: async () => permitted, onRemoved: event('permissionsRemoved') },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async value => calls.push(['register', value]), unregisterContentScripts: async () => {} },
    tabs: { create: async () => ({ id: nextTab++ }), update: async (...args) => calls.push(['update', ...args]), sendMessage: async (...args) => { calls.push(['send', ...args]); return { ok: true }; }, onRemoved: event('removed'), onUpdated: event('updated') },
    windows: { create: async value => { calls.push(['window', value]); return { id: 90, tabs: [{ id: nextTab++ }] }; }, update: async (...args) => calls.push(['focus', ...args]), get: async id => ({ id, state: 'normal' }) }
  };
  const { handleMessage } = await import('../extension/background.js');
  const app = { tab: { id: 7 }, frameId: 0, url: 'https://your-firebase-project.web.app/room/test' };
  await assert.rejects(handleMessage({ source: 'birlikte-app', action: 'OPEN_SOURCE', url: 'https://example.com/episode' }, { ...app, url: 'https://evil.example/' }), /erişim/);
  await handleMessage({ source: 'birlikte-app', action: 'OPEN_SOURCE', url: 'https://example.com/episode' }, app);
  assert.equal(bindings[40].appTabId, 7);
  assert.equal(calls.find(call => call[0] === 'window')[1].type, 'popup');
  assert.equal(bindings[40].windowId, 90);
  await handleMessage({ source: 'birlikte-app', action: 'OPEN_SOURCE', url: 'https://example.com/episode' }, app);
  assert.equal(calls.filter(call => call[0] === 'window').length, 1, 'reopening focuses the existing source window');
  assert.deepEqual(calls.find(call => call[0] === 'focus').slice(1), [90, { focused: true }]);
  await handleMessage({ source: 'birlikte-app', action: 'FULLSCREEN_SOURCE' }, app);
  assert.ok(calls.some(call => call[0] === 'focus' && call[2].state === 'fullscreen'));
  assert.equal((await handleMessage({ source: 'birlikte-source', action: 'HELLO' }, { tab: { id: 123 }, frameId: 0 })).watching, false);
  const source = { tab: { id: 40 }, frameId: 3, url: 'https://player.example/embed' };
  await handleMessage({ source: 'birlikte-source', action: 'STATE', state: { playerId: 'main', time: 10, duration: 60, playing: true, ready: true, area: 200000, audio: [{ label: 'Türkçe' }, { label: 'Japonca' }] } }, source);
  await handleMessage({ source: 'birlikte-app', action: 'COMMAND', command: { action: 'playback', time: 20, playing: false } }, app);
  const command = calls.find(call => call[0] === 'send' && call[2].action === 'COMMAND');
  assert.equal(command[1], 40); assert.equal(command[3].frameId, 3); assert.equal(command[2].playerId, 'main');
  await assert.rejects(handleMessage({ source: 'birlikte-app', action: 'COMMAND', command: { action: 'eval' } }, app), /Desteklenmeyen/);
  await listeners.updated(40, { status: 'loading' }); assert.equal(bindings[40].current, null);
  permitted = false; await listeners.permissionsRemoved(); assert.deepEqual(bindings, {});
  delete globalThis.chrome;
});
