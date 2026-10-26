import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { playbackAt, correctionFor } from '../extension/playback.js';

test('a moving room clock does not rewind to the previous sample and expires after heartbeat loss', () => {
  const clock = { time: 50, playing: true, receivedAt: 10000 };
  const state = { time: 54, playing: true, ready: true, duration: 120 };
  assert.equal(correctionFor(state, clock, 14000), null);
  assert.equal(correctionFor({ ...state, time: 20 }, clock, 14000).time, 54);
  assert.deepEqual(playbackAt(clock, 23000), { time: 62, playing: false });
  assert.equal(correctionFor({ ...state, buffering: true }, clock, 14000), null);
  assert.equal(correctionFor({ ...state, buffering: true }, { ...clock, playing: false }, 14000).playing, false);
});

test('two source windows follow room play, seek and pause through the worker and actual detector script', async () => {
  const sources = new Map(), appEvents = [], windows = []; let bindings = {}, nextTab = 40;
  const event = () => ({ addListener() {} });
  globalThis.chrome = {
    runtime: { id: "test-extension", getManifest: () => ({ version: '0.4.0' }), getURL: path => `chrome-extension://test/${path}`, onMessage: event(), onInstalled: event(), onStartup: event() },
    storage: { session: { get: async () => ({ bindings: structuredClone(bindings) }), set: async value => { bindings = structuredClone(value.bindings); } } },
    permissions: { contains: async () => true, onRemoved: event() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {} },
    windows: { create: async input => { const tabId = nextTab++; windows.push(input); return { id: tabId + 100, tabs: [{ id: tabId }] }; }, update: async () => {} },
    tabs: { update: async () => {}, onRemoved: event(), onUpdated: event(), sendMessage: async (id, message, options) => {
      if (message.event) { appEvents.push({ id, ...message }); return; }
      const source = sources.get(id);
      assert.equal(options.frameId, 3);
      return new Promise(resolve => source.listener(message, {}, resolve));
    } }
  };
  try {
    const { handleMessage } = await import('../extension/background.js?two-source-sync');
    const room = id => ({ tab: { id, windowId: id + 10 }, frameId: 0, url: 'https://your-firebase-project.web.app/room/test' });
    const url = 'https://example.com/episode';
    for (const id of [7, 8]) await handleMessage({ source: 'birlikte-app', action: 'OPEN_SOURCE', url }, room(id));
    const detector = await readFile('extension/source.js', 'utf8');
    async function makeSource(tabId) {
      const handlers = {}, tasks = []; let listener;
      const video = { isConnected: true, dataset: {}, currentTime: 0, duration: 120, paused: true, readyState: 4, volume: 1, muted: false,
        getBoundingClientRect: () => ({ width: 900, height: 500 }), addEventListener(type, fn) { handlers[type] = fn; },
        async play() { this.paused = false; handlers.play?.(); }, pause() { this.paused = true; handlers.pause?.(); } };
      const sender = { tab: { id: tabId }, frameId: 3, url: 'https://video.example/embed' };
      const report = message => { const task = handleMessage(message, sender); tasks.push(task); return task; };
      vm.runInNewContext(detector, { crypto, Date, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, MutationObserver: class { observe() {} },
        window: { addEventListener() {}, postMessage() {} }, document: { title: 'Test episode', querySelectorAll: selector => selector === 'video' ? [video] : [] },
        chrome: { runtime: { id: "test-extension", sendMessage: report, onMessage: { addListener: fn => listener = fn } } } });
      const source = { video, handlers, listener, tasks }; sources.set(tabId, source);
      await new Promise(resolve => setImmediate(resolve)); await Promise.all(tasks.splice(0));
      return source;
    }
    const host = await makeSource(40), guest = await makeSource(41);
    async function sync(time, playing) {
      await handleMessage({ source: 'birlikte-app', action: 'COMMAND', command: { action: 'playback', time, playing } }, room(7));
      await Promise.all(host.tasks.splice(0));
      const state = appEvents.findLast(e => e.id === 7 && e.event === 'SOURCE_STATE').data;
      assert.equal(state.time, time); assert.equal(state.playing, playing);
      await handleMessage({ source: 'birlikte-app', action: 'SYNC_PLAYBACK', url, playback: { time: state.time, playing: state.playing }, controller: false }, room(8));
      await Promise.all(guest.tasks.splice(0));
      assert.ok(Math.abs(guest.video.currentTime - time) < 0.2); assert.equal(guest.video.paused, !playing);
    }
    await sync(25, true);
    await sync(70, true);
    await sync(70, false);
    // A source-side seek on the guest cannot override the room's position.
    const originalNow = Date.now;
    try {
      const advanced = originalNow() + 2000; Date.now = () => advanced;
      guest.video.currentTime = 10; guest.handlers.seeked();
      while (guest.tasks.length) await Promise.all(guest.tasks.splice(0));
      assert.equal(guest.video.currentTime, 70);
      assert.equal(guest.video.paused, true);
    } finally { Date.now = originalNow; }
    assert.equal(windows.length, 2); assert.ok(windows.every(w => w.type === 'popup'));
    const before = guest.video.currentTime;
    await handleMessage({ source: 'birlikte-app', action: 'SYNC_PLAYBACK', url: 'https://other.example/', playback: { time: 0, playing: true } }, room(8));
    assert.equal(guest.video.currentTime, before, 'a stale source cannot control the current window');
    const realNow = Date.now;
    try {
      const advanced = realNow() + 5000; Date.now = () => advanced;
      await handleMessage({ source: 'birlikte-app', action: 'SYNC_PLAYBACK', url, playback: { time: 70, playing: false }, canControl: true }, room(8));
      guest.video.currentTime = 95; guest.handlers.seeked();
      while (guest.tasks.length) await Promise.all(guest.tasks.splice(0));
      assert.equal(guest.video.currentTime, 95, 'a delegated viewer can take control on the source page');
      assert.equal(bindings[41].clock, null, 'the old follower target is released before the room acknowledges the new controller');
      await handleMessage({ source: 'birlikte-app', action: 'SYNC_PLAYBACK', url, playback: { time: 70, playing: false }, canControl: false }, room(8));
      while (guest.tasks.length) await Promise.all(guest.tasks.splice(0));
      assert.equal(guest.video.currentTime, 70, 'revoking control returns the source to following the room');
    } finally { Date.now = realNow; }
  } finally { delete globalThis.chrome; }
});
