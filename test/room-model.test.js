import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, roomSnapshot, directVideoUrl, messageSlot, queueSlot } from '../src/room-model.js';

test('Firebase snapshot compensates for clock offset and detects stale host heartbeats', () => {
  const room = makeRoom('room', 'host', 'Film gecesi', 10000);
  room.presence = { host: { tab1: true } };
  room.playback = { videoId: '0', playing: true, time: 20, updatedAt: 10000 };
  const current = roomSnapshot(room, 12500); assert.equal(current.playback.time, 22.5); assert.equal(current.playback.playing, true);
  const stale = roomSnapshot(room, 30000); assert.equal(stale.playback.time, 28); assert.equal(stale.playback.playing, false);
  delete room.presence.host;
  assert.equal(roomSnapshot(room, 13000).playback.playing, false);
});

test('Firebase profiles are counted once across tabs and offline profiles are hidden', () => {
  const room = makeRoom('room', 'host', 'Test', 10000);
  room.members.guest = { id: 'guest', name: 'Guest' };
  room.presence = { host: { tab1: true, tab2: true } };
  assert.deepEqual(roomSnapshot(room, 10000).members.map(m => m.id), ['host']);
});

test('Firebase storage remains bounded and replaces the oldest message slot', () => {
  const queue = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [String(i), { id: String(i) }]));
  assert.throws(() => queueSlot(queue), /50/); delete queue[12]; assert.equal(queueSlot(queue), '12');
  const messages = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [String(i), { at: i + 100 }]));
  messages[27].at = 1; assert.equal(messageSlot(messages), '27'); delete messages[4]; assert.equal(messageSlot(messages), '4');
});

test('Firebase direct links require HTTPS media and reject embedded credentials', () => {
  assert.equal(directVideoUrl('https://example.com/movie.mp4?token=abc'), 'https://example.com/movie.mp4?token=abc');
  for (const url of ['javascript:alert(1)', 'http://example.com/video.mp4', 'https://youtube.com/watch?v=abc', 'https://user:pass@example.com/video.mp4']) assert.throws(() => directVideoUrl(url));
});
