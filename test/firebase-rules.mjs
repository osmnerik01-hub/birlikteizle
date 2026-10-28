import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, set, get, update, remove, query, orderByValue, endAt, limitToFirst, serverTimestamp } from 'firebase/database';
import { makeRoom } from '../src/room-model.js';

let env;
const id = '2a7b0c58-0cda-42ab-8e9d-71f274feeb44';
const p = `birlikteRooms/${id}`;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-birlikteizle', database: { host: '127.0.0.1', port: 9000, rules: await readFile('database.rules.json', 'utf8') } });
});
after(async () => { await env?.cleanup(); });
const db = uid => uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();

test('only an authenticated creator can establish owner identity', async () => {
  await assertFails(set(ref(db(), p), makeRoom(id, 'host', 'Test', serverTimestamp())));
  await assertFails(set(ref(db('guest'), p), makeRoom(id, 'host', 'Test', serverTimestamp())));
  await assertSucceeds(set(ref(db('host'), p), makeRoom(id, 'host', 'Test', serverTimestamp())));
  await assertFails(set(ref(db('host'), `${p}/meta/host`), 'guest'));
  await assertFails(get(ref(db('host'), 'birlikteRooms')));
});

test('invite holder can join only as self; room content stays behind membership', async () => {
  await assertSucceeds(get(ref(db('guest'), `${p}/meta`)));
  await assertFails(get(ref(db('guest'), p)));
  await assertFails(set(ref(db('guest'), `${p}/members/host`), { id: 'host', name: 'Fake' }));
  await assertSucceeds(set(ref(db('guest'), `${p}/members/guest`), { id: 'guest', name: 'Arkadaş' }));
  await assertSucceeds(get(ref(db('guest'), p)));
  await assertFails(set(ref(db('guest'), `${p}/members/guest/role`), 'host'));
});

test('guest cannot control playback, add videos or forge another participant presence', async () => {
  const playback = { videoId: '0', time: 15, playing: true, updatedAt: serverTimestamp(), controller: 'host' };
  await assertFails(set(ref(db('guest'), `${p}/playback`), playback));
  await assertSucceeds(set(ref(db('host'), `${p}/playback`), playback));
  await assertFails(set(ref(db('host'), `${p}/playback`), { ...playback, time: -1 }));
  await assertFails(set(ref(db('host'), `${p}/playback`), { ...playback, videoId: '49' }));
  await assertFails(set(ref(db('guest'), `${p}/presence/host/tab1`), true));
  await assertSucceeds(set(ref(db('guest'), `${p}/presence/guest/tab1`), true));
  await assertSucceeds(set(ref(db('guest'), `${p}/presence/guest/tab1`), null));
});

test('chat rejects impersonation, oversized messages and unbounded message slots', async () => {
  const message = { id: crypto.randomUUID(), memberId: 'guest', name: 'Arkadaş', text: 'Merhaba 🍿', at: serverTimestamp() };
  await assertSucceeds(set(ref(db('guest'), `${p}/messages/0`), message));
  await assertFails(set(ref(db('guest'), `${p}/messages/1`), { ...message, memberId: 'host' }));
  await assertFails(set(ref(db('guest'), `${p}/messages/1`), { ...message, name: 'host' }));
  await assertFails(set(ref(db('guest'), `${p}/messages/1`), { ...message, text: 'x'.repeat(1001) }));
  await assertFails(set(ref(db('guest'), `${p}/messages/150`), message));
  await assertFails(set(ref(db('guest'), `${p}/messages/1`), { ...message, at: 1 }));
  assert.equal((await get(ref(db('guest'), `${p}/messages/0/text`))).val(), 'Merhaba 🍿');
});

test('video slots and URLs are validated; unrelated database paths remain inaccessible', async () => {
  const video = { id: '1', title: 'Video', source: 'host ekledi', url: 'https://example.com/movie.mp4', order: serverTimestamp() };
  await assertFails(set(ref(db('guest'), `${p}/queue/1`), video));
  await assertSucceeds(set(ref(db('host'), `${p}/queue/1`), video));
  await assertFails(set(ref(db('host'), `${p}/queue/50`), { ...video, id: '50' }));
  await assertFails(set(ref(db('host'), `${p}/queue/2`), { ...video, id: '2', url: 'javascript:alert(1)' }));
  await assertFails(set(ref(db('host'), `${p}/queue/2`), { ...video, id: '2', url: 'http://example.com/v.mp4' }));
  await assertSucceeds(set(ref(db('host'), `${p}/queue/2`), { ...video, id: '2', kind: 'page', url: 'https://example.com/episode/17' }));
  await assertSucceeds(set(ref(db('host'), `${p}/queue/3`), { ...video, id: '3', kind: 'hls', url: 'https://example.com/stream.m3u8' }));
  await assertFails(set(ref(db('guest'), `${p}/queue/4`), { ...video, id: '4', kind: 'page', url: 'https://example.com/page' }));
  await assertFails(set(ref(db('host'), `${p}/queue/4`), { ...video, id: '4', kind: 'script', url: 'https://example.com/video' }));
  await assertSucceeds(update(ref(db('host'), `${p}/meta`), { title: 'New title' }));
  await assertFails(get(ref(db('host'), 'otherApp')));
});

test('owners grant independent capabilities; viewers cannot self-grant or overwrite without manage permission', async () => {
  const host = db('host'), guest = db('guest');
  const grants = { addVideo: true, manageQueue: false, playback: false };
  await assertFails(set(ref(guest, `${p}/permissions/guest`), { ...grants, playback: true }));
  await assertSucceeds(set(ref(host, `${p}/permissions/guest`), grants));
  const item = { id: '4', title: 'Guest video', source: 'Arkadaş', url: 'https://example.com/guest.mp4', order: serverTimestamp() };
  await assertSucceeds(set(ref(guest, `${p}/queue/4`), item));
  await assertFails(set(ref(guest, `${p}/queue/4`), { ...item, title: 'Overwrite' }));
  await assertFails(remove(ref(guest, `${p}/queue/4`)));
  const playback = { videoId: '0', time: 30, playing: true, updatedAt: serverTimestamp(), controller: 'guest' };
  await assertFails(set(ref(guest, `${p}/playback`), playback));
  await assertSucceeds(set(ref(host, `${p}/permissions/guest`), { ...grants, playback: true }));
  await assertSucceeds(set(ref(guest, `${p}/playback`), playback));
  await assertFails(set(ref(guest, `${p}/playback`), { ...playback, videoId: '4' }));
  await assertFails(set(ref(guest, `${p}/playback`), { ...playback, controller: 'host' }));
  await assertSucceeds(set(ref(host, `${p}/permissions/guest`), { ...grants, playback: false, manageQueue: true }));
  await assertFails(set(ref(guest, `${p}/playback`), playback));
  await assertSucceeds(remove(ref(guest, `${p}/queue/4`)));
  await assertSucceeds(set(ref(guest, `${p}/playback`), { ...playback, videoId: '1', time: 0, playing: false }));
  await assertFails(set(ref(guest, `${p}/playback`), { ...playback, videoId: '0', time: 0, playing: true }));
});

test('only the configured verified Google account may administer all rooms', async () => {
  await env.withSecurityRulesDisabled(async context => set(ref(context.database(), 'siteConfig/adminEmail'), 'owner@example.com'));
  const admin = env.authenticatedContext('site-admin', { email: 'owner@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } }).database();
  const fake = env.authenticatedContext('fake-admin', { email: 'owner@example.com', email_verified: false, firebase: { sign_in_provider: 'google.com' } }).database();
  const other = env.authenticatedContext('other-google', { email: 'other@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } }).database();
  const password = env.authenticatedContext('password-admin', { email: 'owner@example.com', email_verified: true, firebase: { sign_in_provider: 'password' } }).database();
  for (const denied of [fake, other, password, db('guest')]) { await assertFails(get(ref(denied, 'siteConfig'))); await assertFails(get(ref(denied, 'roomIndex'))); await assertFails(set(ref(denied, `${p}/closed`), true)); }
  await assertSucceeds(get(ref(admin, 'siteConfig')));
  await assertSucceeds(get(ref(admin, 'roomIndex')));
  await assertFails(set(ref(admin, 'siteConfig/adminEmail'), 'attacker@example.com'));
  await assertSucceeds(set(ref(admin, `${p}/meta/title`), 'Admin room'));
  await assertSucceeds(set(ref(admin, `${p}/permissions/guest`), { addVideo: false, manageQueue: false, playback: false }));
  await assertSucceeds(remove(ref(admin, `${p}/messages`)));
  await assertSucceeds(set(ref(admin, `${p}/closed`), true));
  await assertFails(set(ref(db('guest'), `${p}/messages/0`), { id: crypto.randomUUID(), memberId: 'guest', name: 'Arkadaş', text: 'Closed', at: serverTimestamp() }));
  await assertFails(set(ref(db('host'), `${p}/queue/4`), { id: '4', title: 'Closed', source: 'host', url: 'https://example.com/c.mp4', order: serverTimestamp() }));
  await assertSucceeds(set(ref(admin, `${p}/closed`), false));
});

test('network locations are private to admin and strictly bounded', async () => {
  const path = `roomLocations/${id}/guest`;
  const location = { region: 'Istanbul', country: 'TR', at: serverTimestamp() };
  await assertSucceeds(set(ref(db('guest'), path), location));
  await assertFails(get(ref(db('guest'), path)));
  await assertFails(get(ref(db('host'), `roomLocations/${id}`)));
  await assertFails(set(ref(db('host'), path), location));
  await assertFails(set(ref(db('guest'), path), { ...location, ip: '192.0.2.1' }));
  await assertFails(set(ref(db('guest'), path), { ...location, region: 'x'.repeat(81) }));
  const admin = env.authenticatedContext('google-admin', { email: 'owner@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } }).database();
  assert.equal((await assertSucceeds(get(ref(admin, path)))).val().region, 'Istanbul');
});

test('cleanup can delete expired empty rooms only, and the expiry index reveals no room content', async () => {
  const expired = '3a7b0c58-0cda-42ab-8e9d-71f274feeb44', active = '4a7b0c58-0cda-42ab-8e9d-71f274feeb44', fresh = '5a7b0c58-0cda-42ab-8e9d-71f274feeb44';
  const old = Date.now() - 90000000;
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    for (const id of [expired, active, fresh]) { const raw = makeRoom(id, 'owner', 'Private', id === fresh ? Date.now() : old); if (id === active) raw.presence = { owner: { connection: true } }; await set(ref(db, `birlikteRooms/${id}`), raw); await set(ref(db, `roomIndex/${id}`), old); }
  });
  const stranger = db('cleaner');
  await assertFails(get(ref(stranger, 'roomIndex')));
  await assertSucceeds(set(ref(stranger, 'cleanupClock'), serverTimestamp()));
  const clock = (await get(ref(stranger, 'cleanupClock'))).val();
  await assertFails(set(ref(stranger, 'cleanupClock'), Date.now() + 90000000));
  const index = await assertSucceeds(get(query(ref(stranger, 'roomIndex'), orderByValue(), endAt(clock - 86400000), limitToFirst(50))));
  assert.equal(typeof index.val()[expired], 'number');
  await assertFails(get(ref(stranger, `birlikteRooms/${expired}`)));
  await assertFails(set(ref(stranger, `roomIndex/${expired}`), old));
  await assertFails(remove(ref(stranger, `birlikteRooms/${active}`)));
  await assertFails(remove(ref(stranger, `birlikteRooms/${fresh}`)));
  await assertSucceeds(remove(ref(stranger, `birlikteRooms/${expired}`)));
  await assertSucceeds(remove(ref(stranger, `roomIndex/${expired}`)));
  await assertFails(remove(ref(stranger, `roomIndex/${active}`)));
  await assertFails(get(query(ref(stranger, 'roomIndex'), orderByValue(), endAt(Date.now()), limitToFirst(50))));
});
