import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMediaSource, timeLabel, normalizeTracks } from '../public/media-source.js';
import { isAppUrl, sourceUrl, cleanCommand, cleanState } from '../extension/protocol.js';

test('media sources distinguish web pages, MKV containers, HLS and DASH manifests', () => {
  for (const [url, kind] of [['https://example.com/watch/17', 'page'], ['https://example.com/dual.MKV?key=1', 'video'], ['https://example.com/master.m3u8', 'hls'], ['https://example.com/manifest.mpd', 'dash']]) assert.equal(resolveMediaSource(url).kind, kind);
  assert.equal(resolveMediaSource('https://example.com/play?id=5', 'hls').kind, 'hls');
  for (const url of ['javascript:alert(1)', 'file:///C:/test.mp4', 'https://user:pass@example.com/test.mp4', 'blob:https://example.com/abc']) assert.throws(() => resolveMediaSource(url));
});
test('extension only trusts the actual room origin and safe source schemes', () => {
  assert.equal(isAppUrl('https://your-firebase-project.web.app/room/a'), true);
  assert.equal(isAppUrl('https://your-firebase-project.web.app.evil.example/'), false);
  for (const url of ['chrome://settings', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://your-firebase-project.web.app/']) assert.throws(() => sourceUrl(url));
});
test('extension commands cannot execute arbitrary actions and clamp media properties', () => {
  assert.throws(() => cleanCommand({ action: 'eval', code: 'alert(1)' }));
  assert.throws(() => cleanCommand({ action: 'playback', time: -1, playing: true }));
  assert.deepEqual(cleanCommand({ action: 'volume', volume: 9, muted: true }), { action: 'volume', volume: 1, muted: true });
  const state = cleanState({ time: Infinity, duration: -10, cookie: 'secret', audio: [{ label: 'Türkçe', active: true }] });
  assert.equal(state.time, 0); assert.equal(state.duration, 0); assert.equal('cookie' in state, false); assert.equal(state.audio[0].label, 'Türkçe');
});
test('track menus retain language labels and local selection state', () => {
  assert.deepEqual(normalizeTracks([{ lang: 'tr', enabled: true }, { label: 'Japonca', language: 'ja', enabled: false }], 'Ses').map(t => [t.label, t.active]), [['tr', true], ['Japonca', false]]);
  assert.equal(timeLabel(3661.8), '1:01:01'); assert.equal(timeLabel(Infinity), '0:00');
});
