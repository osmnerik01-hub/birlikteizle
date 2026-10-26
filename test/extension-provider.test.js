import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function harness(globals, video) {
  const output = []; let listener;
  const window = { ...globals, addEventListener: (event, fn) => listener = fn, postMessage: value => output.push(value) };
  vm.runInNewContext(await readFile('extension/source-provider.js', 'utf8'), { window, document: { querySelector: () => video, querySelectorAll: () => [] } });
  return (action, id) => {
    listener({ source: window, data: { source: 'birlikte-provider-request', requestId: crypto.randomUUID(), playerId: crypto.randomUUID(), action, id } });
    return output.at(-1)?.result;
  };
}

test('Video.js adapter exposes and switches dual audio and custom subtitle tracks', async () => {
  const video = {}, audio = [{ label: 'Türkçe', enabled: true }, { label: 'Japonca', enabled: false }], text = [{ label: 'TR', mode: 'disabled' }];
  const player = { el: () => ({ contains: node => node === video }), audioTracks: () => audio, textTracks: () => text };
  const request = await harness({ videojs: { getPlayers: () => ({ main: player }) } }, video);
  assert.equal(request('inspect').audio.length, 2);
  request('audio', 'api:1'); assert.equal(audio[1].enabled, true); assert.equal(audio[0].enabled, false);
  request('subtitle', 'api:0'); assert.equal(text[0].mode, 'showing');
  request('subtitle', 'off'); assert.equal(text[0].mode, 'disabled');
  assert.equal(request('audio', 'api:39').ok, false);
});
test('Hls.js source adapter selects manifest audio and subtitle indices without reading credentials', async () => {
  const video = {}, hls = { media: video, audioTracks: [{ name: 'TR' }, { name: 'JP' }], subtitleTracks: [{ name: 'TR' }], audioTrack: 0, subtitleTrack: -1, subtitleDisplay: false };
  const request = await harness({ hls }, video);
  assert.equal(request('inspect').audio[0].active, true);
  request('audio', 'api:1'); assert.equal(hls.audioTrack, 1);
  request('subtitle', 'api:0'); assert.equal(hls.subtitleTrack, 0); assert.equal(hls.subtitleDisplay, true);
  request('subtitle', 'off'); assert.equal(hls.subtitleTrack, -1); assert.equal(hls.subtitleDisplay, false);
});
