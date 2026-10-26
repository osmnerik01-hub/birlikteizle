import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseBackend } from '../src/firebase-client.js';

async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Realtime state timed out'); await new Promise(resolve => setTimeout(resolve, 30)); }
}

test('two Firebase clients create a room, exchange chat and synchronize video through real rules', { timeout: 60000 }, async () => {
  const config = { apiKey: 'demo-api-key', projectId: 'demo-birlikteizle', databaseURL: 'https://demo-birlikteizle-default-rtdb.firebaseio.com' };
  const host = await createFirebaseBackend({ config, appName: 'host-client', emulators: true });
  const guest = await createFirebaseBackend({ config, appName: 'guest-client', emulators: true });
  let hostState, guestState, failure;
  try {
    const { id } = await host.request('create');
    const joinedHost = await host.request('join', id, { name: 'Owner' });
    const joinedGuest = await guest.request('join', id, { name: 'Arkadaş' });
    assert.notEqual(joinedHost.memberId, joinedGuest.memberId);
    host.subscribe(id, state => hostState = state, () => {}, error => failure = error);
    guest.subscribe(id, state => guestState = state, () => {}, error => failure = error);
    await until(() => failure || hostState?.members.length === 2 && guestState?.members.length === 2);
    if (failure) throw failure;
    await guest.request('message', id, { text: 'Merhaba 🍿' });
    await until(() => hostState?.messages.some(message => message.text === 'Merhaba 🍿'));
    const burst = Array.from({ length: 6 }, (_, i) => `burst-${i}`);
    await Promise.all(burst.map((text, i) => (i % 2 ? host : guest).request('message', id, { text })));
    await until(() => burst.every(text => hostState?.messages.some(message => message.text === text)));
    for (const text of burst) assert.equal(hostState.messages.filter(message => message.text === text).length, 1);
    await assert.rejects(guest.request('playback', id, { time: 5, playing: true }), /yetkin/);
    await host.request('video', id, { title: 'Test video', url: 'https://example.com/movie.mp4' });
    await until(() => guestState?.queue.length === 2);
    await host.request('select', id, { videoId: '1' });
    await until(() => hostState?.playback.videoId === '1');
    await host.request('playback', id, { time: 42, playing: true });
    await until(() => guestState?.playback.playing === true);
    assert.ok(guestState.playback.time >= 42 && guestState.playback.time < 44);
    await host.request('video', id, { title: 'Web oynatıcı', url: 'https://example.com/episode/17' });
    await until(() => guestState?.queue.length === 3);
    assert.equal(guestState.queue[2].kind, 'page');
    await host.request('permissions', id, { memberId: joinedGuest.memberId, permissions: { addVideo: true, playback: true } });
    await until(() => guestState?.permissions[joinedGuest.memberId]?.playback);
    await guest.request('video', id, { title: 'Guest video', url: 'https://example.com/guest.mp4' });
    await until(() => hostState?.queue.length === 4);
    await assert.rejects(guest.request('select', id, { videoId: '3' }), /yetkin/);
    await guest.request('playback', id, { videoId: '1', time: 65, playing: true });
    await until(() => hostState?.playback.controller === joinedGuest.memberId);
    await host.request('playback', id, { time: 1, playing: false, heartbeat: true });
    assert.ok(hostState.playback.time >= 65, 'the former controller heartbeat cannot rewind the new leader');
    await host.request('permissions', id, { memberId: joinedGuest.memberId, permissions: { addVideo: true } });
    await until(() => !guestState?.permissions[joinedGuest.memberId]?.playback);
    await until(() => guestState?.playback.playing === false);
    await assert.rejects(guest.request('playback', id, { time: 10, playing: true }), /yetkin/);
    // Fill the bounded history without a subscription, then race both clients
    // against the same oldest slot. A transaction's cold null must not abort it.
    const fullRoom = (await host.request('create')).id;
    await host.request('join', fullRoom, { name: 'Owner' });
    for (let i = 0; i < 150; i++) await host.request('message', fullRoom, { text: `history-${i}` });
    await guest.request('join', fullRoom, { name: 'Guest' });
    const replacementBurst = ['full-a', 'full-b', 'full-c', 'full-d'];
    await Promise.all(replacementBurst.map((text, i) => (i % 2 ? host : guest).request('message', fullRoom, { text })));
    const fullHistory = (await host.request('join', fullRoom, { name: 'Owner' })).room.messages;
    assert.equal(fullHistory.length, 150);
    for (const text of replacementBurst) assert.equal(fullHistory.filter(message => message.text === text).length, 1);
    await host.cleanupExpired();
    await host.dispose();
    await until(() => guestState?.members.length === 1);
    assert.equal(guestState.playback.playing, false);
  } catch (error) { console.error(error); throw error; }
  finally { await Promise.allSettled([host.dispose(), guest.dispose()]); }
});
