import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let server, base, room, host, guest, uploaded, directory;
const adminKey = 'test-only-admin-key-with-at-least-thirty-two-characters';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function post(route, data, token) {
  const response = await fetch(`${base}/api/rooms${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}
async function start() {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: directory, ADMIN_TOKEN: adminKey, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://watch.example.test', STORAGE_QUOTA_MB: '1', MAX_UPLOAD_MB: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; server.stderr.on('data', chunk => errors += chunk);
  base = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 10000); server.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } }); server.on('error', reject); server.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(errors)); } }); });
}
async function stop() { if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
before(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'birlikte-test-')); await start(); });
after(async () => { await stop(); if (directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('birlikte-test-')) await rm(directory, { recursive: true, force: true }); });

test('rooms, identities and live events work for independent participants', async () => {
  const created = await post('', { title: 'Test odası' }); assert.equal(created.status, 201); room = created.data.id;
  host = (await post(`/${room}/join`, { name: 'Owner' })).data;
  guest = (await post(`/${room}/join`, { name: 'Arkadaş' })).data;
  assert.equal(host.room.host, host.memberId); assert.notEqual(host.token, guest.token);
  const resumed = (await post(`/${room}/join`, { name: 'Owner', token: host.token })).data;
  assert.equal(resumed.memberId, host.memberId); assert.equal(resumed.room.host, host.memberId);
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/rooms/${room}/events`, { headers: { Authorization: `Bearer ${guest.token}` }, signal: controller.signal });
  const reader = stream.body.getReader(); const decoder = new TextDecoder();
  let pending = '';
  async function nextState(predicate) {
    for (let tries = 0; tries < 20; tries++) {
      const { value, done } = await reader.read(); if (done) throw new Error('Unexpected end of event stream'); pending += decoder.decode(value);
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) { const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2); if (event.startsWith('data: ')) { const value = JSON.parse(event.slice(6)); if (predicate(value)) return value; } }
    }
    throw new Error('Expected room event not received');
  }
  try {
    const connected = await nextState(s => s.members.length === 1); assert.equal(connected.members[0].id, guest.memberId);
    assert.equal((await post(`/${room}/message`, { text: '<script>hello</script>' }, host.token)).status, 200);
    const message = await nextState(s => s.messages.length === 1); assert.equal(message.messages[0].text, '<script>hello</script>');
    assert.equal((await post(`/${room}/playback`, { time: 42, playing: true }, guest.token)).status, 403);
    assert.equal((await post(`/${room}/playback`, { time: 42, playing: true }, host.token)).status, 200);
    const playing = await nextState(s => s.playback.playing); assert.ok(playing.playback.time >= 42); assert.ok(playing.playback.time < 44);
    assert.equal((await post(`/${room}/playback`, { time: -1, playing: false }, host.token)).status, 400);
  } finally { controller.abort(); }
});

test('video links are validated and selecting a video resets playback', async () => {
  assert.equal((await post(`/${room}/video`, { url: 'javascript:alert(1)' }, host.token)).status, 400);
  assert.equal((await post(`/${room}/video`, { url: 'https://youtube.com/watch?v=test', title: 'Kaynak sayfa' }, host.token)).status, 200);
  const page = (await post(`/${room}/join`, { name: 'Kontrol' })).data.room.queue.at(-1);
  assert.equal(page.kind, 'page');
  assert.equal((await post(`/${room}/video`, { url: 'https://example.com/movie.mp4', title: 'Film' }, guest.token)).status, 403);
  assert.equal((await post(`/${room}/video`, { url: 'https://example.com/movie.mp4?token=x', title: 'Film' }, host.token)).status, 200);
  const viewer = (await post(`/${room}/join`, { name: 'Yeni izleyici' })).data;
  const item = viewer.room.queue.at(-1); assert.equal(item.title, 'Film');
  assert.equal((await post(`/${room}/select`, { videoId: item.id }, host.token)).status, 200);
  const snapshot = (await post(`/${room}/join`, { name: 'Yeni' })).data.room;
  assert.equal(snapshot.playback.videoId, item.id); assert.equal(snapshot.playback.time, 0); assert.equal(snapshot.playback.playing, false);
});

test('uploads require host authorization and support byte ranges for seeking', async () => {
  const bytes = Buffer.from('test-video-content-for-range-check');
  const upload = token => fetch(`${base}/api/rooms/${room}/upload?name=sample.mp4`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: bytes });
  assert.equal((await upload(guest.token)).status, 403);
  assert.equal((await upload(host.token)).status, 201);
  const snapshot = (await post(`/${room}/join`, { name: 'İzleyici' })).data.room;
  uploaded = snapshot.queue.at(-1).url;
  assert.equal((await fetch(`${base}${uploaded}`)).status, 401);
  const range = await fetch(`${base}${uploaded}`, { headers: { Range: 'bytes=5-9', Cookie: `bi_${room}=${host.token}` } });
  assert.equal(range.status, 206); assert.equal(await range.text(), bytes.subarray(5, 10).toString()); assert.equal(range.headers.get('content-range'), `bytes 5-9/${bytes.length}`);
  const invalid = await fetch(`${base}${uploaded}`, { headers: { Range: 'bytes=999999-', Authorization: `Bearer ${guest.token}` } }); assert.equal(invalid.status, 416);
});

test('room routes serve the app and missing rooms return useful errors', async () => {
  const page = await fetch(`${base}/room/${room}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('cache-control'), /no-cache.*must-revalidate/);
  for (const asset of ['/message-queue.js', '/update-client.js', '/admin-auth.js', '/favicon.svg']) {
    const response = await fetch(`${base}${asset}?v=0123456789abcdef`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-cache/);
  }
  assert.equal((await post('/00000000/join', { name: 'Test' })).status, 404);
  assert.equal((await post(`/${room}/message`, { text: 'hello' }, 'invalid')).status, 401);
  assert.equal((await fetch(`${base}/admin.html`)).headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
});

test('production rejects foreign origins and HTTP media; cookies protect event streams', async () => {
  const foreign = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  assert.equal((await post(`/${room}/video`, { url: 'http://example.com/video.mp4' }, host.token)).status, 400);
  const joined = await fetch(`${base}/api/rooms/${room}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://watch.example.test' }, body: JSON.stringify({ name: 'Owner', token: host.token }) });
  const cookie = joined.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\//);
  assert.equal((await fetch(`${base}/api/rooms/${room}/events?token=${host.token}`)).status, 401);
  const status = await fetch(`${base}/api/rooms/${room}/status`, { headers: { Cookie: `bi_${room}=${host.token}` } }); assert.equal(status.status, 200);
  const health = await fetch(`${base}/healthz`); assert.equal(health.status, 200); assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('server restart preserves room, chat, uploads and owner identity without raw tokens in SQLite', async () => {
  assert.equal((await post(`/${room}/playback`, { time: 77, playing: true }, host.token)).status, 200);
  await stop();
  const db = new DatabaseSync(path.join(directory, 'birlikte.sqlite'));
  const payload = db.prepare('SELECT payload FROM rooms WHERE id=?').get(room).payload;
  assert.ok(!payload.includes(host.token)); assert.ok(!payload.includes(guest.token)); db.close();
  await start();
  const restored = (await post(`/${room}/join`, { name: 'Owner', token: host.token })).data;
  assert.equal(restored.memberId, host.memberId); assert.equal(restored.room.host, host.memberId);
  assert.equal(restored.room.messages[0].text, '<script>hello</script>');
  assert.equal(restored.room.queue.at(-1).url, uploaded); assert.equal(restored.room.playback.playing, false);
  assert.ok(restored.room.playback.time >= 77 && restored.room.playback.time < 80);
  const cookieResume = await fetch(`${base}/api/rooms/${room}/join`, { method: 'POST', headers: { Cookie: `bi_${room}=${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Owner' }) });
  assert.equal((await cookieResume.json()).memberId, host.memberId);
  const response = await fetch(`${base}${uploaded}`, { headers: { Authorization: `Bearer ${guest.token}` } }); assert.equal(await response.text(), 'test-video-content-for-range-check');
});

test('upload size and total storage quotas reject excess without adding a queue item', async () => {
  const oversized = await fetch(`${base}/api/rooms/${room}/upload?name=large.mp4`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}` }, body: Buffer.alloc(1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  const quota = await fetch(`${base}/api/rooms/${room}/upload?name=full.mp4`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}` }, body: Buffer.alloc(1024 * 1024) });
  assert.equal(quota.status, 507);
  const restored = (await post(`/${room}/join`, { name: 'Owner', token: host.token })).data;
  assert.equal(restored.room.queue.length, 4);
});

test('owner can delegate independent rights; admin endpoints reject viewers and manage rooms', async () => {
  const created = await post('', { title: 'Yetki testi' }); const id = created.data.id;
  const owner = (await post(`/${id}/join`, { name: 'Owner' })).data, viewer = (await post(`/${id}/join`, { name: 'Viewer' })).data;
  const admin = async (suffix, input, key = adminKey) => { const response = await fetch(`${base}/api/admin${suffix}`, { method: input ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) }); return { status: response.status, data: await response.json() }; };
  assert.equal((await admin('/rooms', null, viewer.token)).status, 403);
  assert.ok((await admin('/rooms')).data.rooms.some(room => room.id === id));
  assert.equal((await post(`/${id}/permissions`, { memberId: viewer.memberId, permissions: { playback: true } }, viewer.token)).status, 403);
  assert.equal((await post(`/${id}/permissions`, { memberId: viewer.memberId, permissions: { playback: true, addVideo: true } }, owner.token)).status, 200);
  assert.equal((await post(`/${id}/video`, { title: 'Viewer video', url: 'https://example.com/guest.mp4' }, viewer.token)).status, 200);
  const items = (await post(`/${id}/join`, { name: 'Viewer', token: viewer.token })).data.room.queue;
  assert.equal((await post(`/${id}/select`, { videoId: items[1].id }, viewer.token)).status, 403);
  assert.equal((await post(`/${id}/playback`, { time: 60, playing: true }, viewer.token)).status, 200);
  await post(`/${id}/playback`, { time: 1, playing: false, heartbeat: true }, owner.token);
  let snapshot = (await post(`/${id}/join`, { name: 'Owner', token: owner.token })).data.room;
  assert.equal(snapshot.playback.controller, viewer.memberId); assert.ok(snapshot.playback.time >= 60);
  await admin(`/rooms/${id}`, { action: 'permissions', memberId: viewer.memberId, permissions: { manageQueue: true } });
  assert.equal((await post(`/${id}/playback`, { time: 5, playing: true }, viewer.token)).status, 403);
  assert.equal((await post(`/${id}/select`, { videoId: items[1].id }, viewer.token)).status, 200);
  assert.equal((await post(`/${id}/remove-video`, { videoId: items[1].id }, viewer.token)).status, 200);
  assert.equal((await post(`/${id}/remove-video`, { videoId: items[0].id }, viewer.token)).status, 400);
  await admin(`/rooms/${id}`, { action: 'rename', title: 'Yeni isim' });
  assert.equal((await admin(`/rooms/${id}`)).data.room.title, 'Yeni isim');
  await admin(`/rooms/${id}`, { action: 'closed', closed: true });
  assert.equal((await post(`/${id}/join`, { name: 'Blocked' })).status, 410);
  await admin(`/rooms/${id}`, { action: 'closed', closed: false });
  assert.equal((await post(`/${id}/join`, { name: 'Allowed' })).status, 200);
  await admin(`/rooms/${id}`, { action: 'delete' });
  assert.equal((await post(`/${id}/join`, { name: 'Gone' })).status, 404);
});

test('maintenance removes expired empty rooms and uploaded files while protecting active rooms', async () => {
  const stale = (await post('', { title: 'Expired' })).data.id, active = (await post('', { title: 'Active' })).data.id;
  const staleOwner = (await post(`/${stale}/join`, { name: 'Stale owner' })).data, activeOwner = (await post(`/${active}/join`, { name: 'Active owner' })).data;
  const response = await fetch(`${base}/api/rooms/${stale}/upload?name=expired.mp4`, { method: 'POST', headers: { Authorization: `Bearer ${staleOwner.token}` }, body: Buffer.from('expired test upload') }); assert.equal(response.status, 201);
  const filesBefore = (await readdir(path.join(directory, 'uploads'))).length;
  await stop();
  const db = new DatabaseSync(path.join(directory, 'birlikte.sqlite'));
  for (const id of [stale, active]) { const data = JSON.parse(db.prepare('SELECT payload FROM rooms WHERE id=?').get(id).payload); data.touchedAt = Date.now() - 90000000; db.prepare('UPDATE rooms SET payload=? WHERE id=?').run(JSON.stringify(data), id); } db.close();
  await start(); const controller = new AbortController();
  await fetch(`${base}/api/rooms/${active}/events`, { headers: { Authorization: `Bearer ${activeOwner.token}` }, signal: controller.signal });
  try {
    const cleaned = await fetch(`${base}/api/admin/cleanup`, { method: 'POST', headers: { Authorization: `Bearer ${adminKey}` } });
    assert.equal((await cleaned.json()).removed, 1);
    assert.equal((await post(`/${stale}/join`, { name: 'Gone' })).status, 404);
    assert.equal((await post(`/${active}/join`, { name: 'Still here' })).status, 200);
    assert.equal((await readdir(path.join(directory, 'uploads'))).length, filesBefore - 1);
  } finally { controller.abort(); }
});

test('room creation rate limits have retry guidance', async () => {
  let response;
  for (let i = 0; i < 11; i++) response = await fetch(`${base}/api/rooms`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0);
});
