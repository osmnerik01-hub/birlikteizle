import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('source detector finds an HTML5 player and applies seek, dual audio and subtitle commands', async () => {
  const reports = [], handlers = {}; let listener, invalidated = false, sends = 0, tick; let now = 10000;
  const video = {
    isConnected: true, dataset: {}, get currentTime() { return this.position || 0; }, set currentTime(value) { this.position = value; this.seeking = true; handlers.seeking?.(); }, duration: 120, paused: true, ended: false, readyState: 4, volume: 1, muted: false,
    audioTracks: [{ label: 'Türkçe', enabled: true }, { label: 'Japonca', enabled: false }],
    textTracks: [{ label: 'Türkçe', mode: 'disabled' }, { label: 'English', mode: 'disabled' }],
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    addEventListener(type, fn) { handlers[type] = fn; },
    async play() { this.paused = false; handlers.play?.(); }, pause() { this.paused = true; handlers.pause?.(); }
  };
  const context = { crypto, console, Date: { now: () => now }, setTimeout: () => 0, clearTimeout() {}, window: { addEventListener() {}, postMessage() {} }, setInterval: fn => { tick = fn; return 0; }, MutationObserver: class { observe() {} }, document: { title: 'Episode 17', querySelectorAll: selector => selector === 'video' ? [video] : [] }, chrome: { runtime: { id: "test-extension",
    onMessage: { addListener: fn => listener = fn }, sendMessage: message => { sends++; if (invalidated) throw new Error('Extension context invalidated.'); reports.push(message); return Promise.resolve({ watching: true }); }
  } } };
  vm.runInNewContext(await readFile('extension/source.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const state = reports.find(r => r.action === 'STATE').state; assert.equal(state.audio.length, 2); assert.equal(state.subtitles.length, 2);
  const command = value => new Promise(resolve => listener({ source: 'birlikte-extension', action: 'COMMAND', playerId: state.playerId, command: value }, {}, resolve));
  assert.equal((await command({ action: 'playback', time: 30, playing: true })).ok, true); assert.equal(video.currentTime, 30); assert.equal(video.paused, false);
  now += 10000; video.seeking = false; handlers.seeked();
  assert.equal(reports.filter(r => r.action === 'STATE').at(-1).state.userAction, false, 'a slow remote seek never becomes a manual takeover');
  await command({ action: 'audio', id: '1' }); assert.equal(video.audioTracks[0].enabled, false); assert.equal(video.audioTracks[1].enabled, true);
  await command({ action: 'subtitle', id: '0' }); assert.equal(video.textTracks[0].mode, 'showing'); assert.equal(video.textTracks[1].mode, 'disabled');
  await command({ action: 'subtitle', id: 'off' }); assert.equal(video.textTracks[0].mode, 'disabled');
  const last = reports.filter(r => r.action === 'STATE').at(-1); assert.equal(last.state.userAction, false);
  invalidated = true; tick(); const attempts = sends; tick(); handlers.play();
  assert.equal(sends, attempts, 'invalidated source stops calling the extension');
  listener({ source: 'birlikte-extension', action: 'STOP' }, {}, () => {});
  assert.equal(video.paused, true, 'closing the room pauses its mapped source player');
  const count = reports.length; handlers.play(); assert.equal(reports.length, count);
});
