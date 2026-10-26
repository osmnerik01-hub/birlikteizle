import http from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, readdir } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage } from './storage.js';
import { resolveMediaSource } from './public/media-source.js';
import { permissionsFor, controllerOf, PERMISSIONS, IDLE_ROOM_TTL_MS } from './public/room-policy.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const uploadDir = path.join(dataDir, 'uploads');
await mkdir(uploadDir, { recursive: true });
const storage = openStorage(dataDir);
const rooms = storage.load();
const production = process.env.NODE_ENV === 'production';
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
if (production && (!publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
function positiveSetting(key, fallback) { const value = Number(process.env[key] ?? fallback); if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}`); return value; }
const maxUpload = positiveSetting('MAX_UPLOAD_MB', 500) * 1024 * 1024;
const storageQuota = positiveSetting('STORAGE_QUOTA_MB', 10240) * 1024 * 1024;
const maxRooms = positiveSetting('MAX_ROOMS', 1000);
const maxMembers = positiveSetting('MAX_MEMBERS_PER_ROOM', 100);
const idleRoomTtl = positiveSetting('ROOM_IDLE_HOURS', 24) * 3600000;
const adminToken = process.env.ADMIN_TOKEN || '';
if (adminToken && adminToken.length < 32) throw new Error('ADMIN_TOKEN must contain at least 32 characters.');
let usedStorage = 0, reservedStorage = 0, shuttingDown = false;
for (const name of await readdir(uploadDir)) { const info = await stat(path.join(uploadDir, name)); if (info.isFile()) usedStorage += info.size; }
const rateBuckets = new Map();
const hashToken = token => createHash('sha256').update(String(token || '')).digest('hex');
function cookieToken(req, room) { const entry = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`bi_${room.id}=`)); return entry?.slice(entry.indexOf('=') + 1); }
function requestToken(req, room) { return req.headers.authorization?.replace(/^Bearer /, '') || cookieToken(req, room); }
function sessionCookie(res, room, token) { res.setHeader('Set-Cookie', `bi_${room.id}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${publicOrigin?.startsWith('https:') ? '; Secure' : ''}`); }
function rateLimit(key, limit, windowMs, res) {
  const now = Date.now(); let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.until) { bucket = { count: 0, until: now + windowMs }; rateBuckets.set(key, bucket); }
  if (++bucket.count > limit) { res.setHeader('Retry-After', Math.ceil((bucket.until - now) / 1000)); fail('Çok fazla istek gönderildi. Biraz sonra tekrar dene.', 429); }
}
const sample = { id: 'demo', title: 'Küçük bir bahar molası', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm', source: 'Örnek video · MDN / CC0' };
function currentTime(room) { return room.playback.time + (room.playback.playing ? (Date.now() - room.playback.updatedAt) / 1000 : 0); }
function snapshot(room) {
  return { id: room.id, title: room.title, host: room.host, closed: room.closed === true, permissions: room.permissions || {}, members: [...room.members.values()].filter(m => m.streams.size).map(({ id, name }) => ({ id, name })), queue: room.queue, messages: room.messages, playback: { ...room.playback, time: currentTime(room), updatedAt: Date.now() } };
}
function broadcast(room) { const data = `data: ${JSON.stringify(snapshot(room))}\n\n`; for (const member of room.members.values()) for (const stream of member.streams) { if (stream.destroyed || stream.writableEnded) continue; if (stream.writableLength > 1024 * 1024) stream.destroy(); else stream.write(data); } }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 32000) fail('İstek çok büyük.', 413); chunks.push(chunk); } const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Geçerli bir JSON nesnesi gerekli.'); return input; }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function auth(room, req) { const member = room.members.get(hashToken(requestToken(req, room))); if (!member) fail('Odaya yeniden katılmalısın.', 401); member.lastSeen = Date.now(); return member; }
function hostOnly(room, member) { if (room.host !== member.id) fail('Videoyu yalnızca oda sahibi yönetebilir.', 403); }
function requirePermission(room, member, key) { if (!permissionsFor(room, member.id)[key]) fail('Bu işlem için oda sahibinden yetki almalısın.', 403); }
function assertAdmin(req) { if (!adminToken) fail('Sunucuda ADMIN_TOKEN yapılandırılmamış.', 503); if (!timingSafeEqual(Buffer.from(hashToken(req.headers.authorization?.replace(/^Bearer /, ''))), Buffer.from(hashToken(adminToken)))) fail('Yönetici anahtarı geçersiz.', 403); }
async function releaseUpload(url) {
  if (!/^\/uploads\/[a-f0-9-]{36}\.(mp4|webm|ogg|ogv|mov|mkv|m4v)$/.test(url)) return;
  const target = path.resolve(uploadDir, path.basename(url));
  if (path.dirname(target) !== uploadDir) throw new Error('Invalid upload path');
  try { const info = await stat(target); await unlink(target); usedStorage = Math.max(0, usedStorage - info.size); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function deleteRoom(room) {
  room.closed = true; broadcast(room);
  for (const member of room.members.values()) for (const stream of member.streams) stream.end();
  rooms.delete(room.id); storage.delete(room.id);
  for (const url of new Set(room.queue.map(item => item.url))) await releaseUpload(url);
}
async function cleanIdleRooms() {
  let removed = 0;
  for (const room of rooms.values()) {
    if ([...room.members.values()].some(member => member.streams.size)) continue;
    if (Date.now() - room.touchedAt >= idleRoomTtl) { await deleteRoom(room); removed++; }
  }
  return { removed };
}
function setPermissions(room, memberId, input) {
  if (![...room.members.values()].some(member => member.id === memberId)) fail('Katılımcı bulunamadı.', 404);
  const value = Object.fromEntries(Object.keys(PERMISSIONS).map(key => [key, input?.[key] === true]));
  room.permissions ||= {}; room.permissions[memberId] = value;
  if (controllerOf(room) === memberId && !value.playback && memberId !== room.host) room.playback = { ...room.playback, time: currentTime(room), playing: false, updatedAt: Date.now() };
}
function videoSource(value, kind) { let source; try { source = resolveMediaSource(value, kind); } catch (error) { fail(error.message); } if (production && !source.url.startsWith('https:')) fail('İnternet sürümünde HTTPS video bağlantısı kullan.'); return source; }

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; media-src 'self' https: http:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const url = new URL(req.url, 'http://localhost');
    if (shuttingDown) fail('Sunucu yeniden başlatılıyor.', 503);
    if (url.pathname === '/healthz' && req.method === 'GET') { storage.health(); return json(res, 200, { status: 'ok' }); }
    if (url.pathname === '/app-config.json' && req.method === 'GET') return json(res, 200, { backend: 'node' });
    if (req.headers.origin && req.headers.origin !== (publicOrigin || `http://${req.headers.host}`)) fail('Bu kaynaktan isteğe izin verilmiyor.', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site' && url.pathname.startsWith('/api/')) fail('Bu kaynaktan isteğe izin verilmiyor.', 403);
    // Caddy overwrites this header; only trust it when the app port is private.
    const ip = process.env.TRUST_PROXY === '1' ? (req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() || req.socket.remoteAddress) : req.socket.remoteAddress;
    if (url.pathname.startsWith('/api/')) rateLimit(`api:${ip}`, 600, 60000, res);
    if (url.pathname.startsWith('/api/admin/')) {
      assertAdmin(req);
      if (url.pathname === '/api/admin/rooms' && req.method === 'GET') {
        const before = Number(url.searchParams.get('beforeAt') || Infinity), beforeId = url.searchParams.get('beforeId') || '';
        const entries = [...rooms.values()].filter(room => room.touchedAt < before || room.touchedAt === before && room.id < beforeId).sort((a,b) => b.touchedAt - a.touchedAt || b.id.localeCompare(a.id)).slice(0,50);
        const last = entries.at(-1);
        return json(res, 200, { rooms: entries.map(room => ({ id: room.id, title: room.title, host: room.host, lastActiveAt: room.touchedAt })), cursor: entries.length === 50 ? { at: last.touchedAt, id: last.id } : null });
      }
      if (url.pathname === '/api/admin/cleanup' && req.method === 'POST') return json(res, 200, await cleanIdleRooms());
      const match = url.pathname.match(/^\/api\/admin\/rooms\/([a-f0-9-]{36})$/);
      if (!match) fail('Yönetim işlemi bulunamadı.', 404);
      const room = rooms.get(match[1]); if (!room) fail('Oda bulunamadı.', 404);
      if (req.method === 'GET') return json(res, 200, { room: snapshot(room), raw: { members: Object.fromEntries([...room.members.values()].map(({ id, name }) => [id, { id, name }])) } });
      if (req.method !== 'POST') fail('Desteklenmeyen istek.', 405);
      const input = await body(req);
      if (input.action === 'delete') { await deleteRoom(room); return json(res, 200, { ok: true }); }
      if (input.action === 'closed') { room.closed = input.closed === true; if (room.closed) room.playback = { ...room.playback, time: currentTime(room), playing: false, updatedAt: Date.now() }; }
      else if (input.action === 'rename') { room.title = String(input.title || '').trim().slice(0,70); if (!room.title) fail('Oda adı boş olamaz.'); }
      else if (input.action === 'pause') room.playback = { ...room.playback, time: currentTime(room), playing: false, updatedAt: Date.now(), controller: 'site-admin' };
      else if (input.action === 'clear-chat') room.messages = [];
      else if (input.action === 'permissions') setPermissions(room, input.memberId, input.permissions);
      else if (input.action === 'host') { if (![...room.members.values()].some(m => m.id === input.memberId)) fail('Katılımcı bulunamadı.'); room.playback = { ...room.playback, time: currentTime(room), playing: false, updatedAt: Date.now(), controller: 'site-admin' }; room.host = input.memberId; }
      else fail('Desteklenmeyen yönetim işlemi.');
      storage.save(room); broadcast(room); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      rateLimit(`create:${ip}`, 10, 60000, res);
      if (rooms.size >= maxRooms) fail('Oda kapasitesine ulaşıldı. Daha sonra tekrar dene.', 503);
      const input = await body(req);
      const id = randomUUID();
      const room = { id, title: String(input.title || 'Birlikte güzel bir akşam').slice(0, 70), host: null, members: new Map(), permissions: {}, queue: [{ ...sample }], messages: [], playback: { videoId: sample.id, time: 0, playing: false, updatedAt: Date.now() }, touchedAt: Date.now() };
      storage.save(room); rooms.set(id, room); return json(res, 201, { id });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{8}|[a-f0-9-]{36})\/(join|events|message|video|playback|select|remove-video|permissions|upload|status)$/);
    if (match) {
      const room = rooms.get(match[1]); if (!room) fail('Bu oda bulunamadı. Yeni bir oda oluşturabilirsin.', 404);
      const action = match[2];
      if (room.closed) fail('Bu oda yönetici tarafından kapatıldı.', 410);
      if (action === 'status' && req.method === 'GET') { auth(room, req); return json(res, 200, { ok: true }); }
      if (action === 'join' && req.method === 'POST') {
        rateLimit(`join:${ip}`, 60, 60000, res);
        const input = await body(req); const name = String(input.name || 'Misafir').trim().slice(0, 24) || 'Misafir';
        const priorToken = input.token || cookieToken(req, room);
        if (priorToken && room.members.has(hashToken(priorToken))) {
          const existing = room.members.get(hashToken(priorToken)); existing.name = name; existing.lastSeen = Date.now(); room.touchedAt = Date.now();
          storage.save(room); sessionCookie(res, room, priorToken); broadcast(room); return json(res, 200, { token: priorToken, memberId: existing.id, room: snapshot(room) });
        }
        for (const [hash, member] of room.members) if (member.id !== room.host && !member.streams.size && Date.now() - member.lastSeen > IDLE_ROOM_TTL_MS) { room.members.delete(hash); if (room.permissions) delete room.permissions[member.id]; }
        if (room.members.size >= maxMembers) fail('Bu odanın katılımcı kapasitesi dolu.', 409);
        const token = randomUUID(); const id = randomUUID();
        room.members.set(hashToken(token), { id, name, streams: new Set(), lastSeen: Date.now() });
        room.touchedAt = Date.now();
        if (!room.host) { room.host = id; room.playback.controller = id; }
        storage.save(room); sessionCookie(res, room, token);
        return json(res, 200, { token, memberId: id, room: snapshot(room) });
      }
      if (action === 'events' && req.method === 'GET') {
        const member = auth(room, req);
        if (member.streams.size >= 5) fail('Çok fazla açık sekme var.', 429);
        if ([...rooms.values()].reduce((n, r) => n + [...r.members.values()].reduce((s, m) => s + m.streams.size, 0), 0) >= 500) fail('Canlı bağlantı kapasitesi dolu.', 503);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.on('error', () => res.destroy());
        member.streams.add(res); broadcast(room);
        const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); room.touchedAt = Date.now(); member.lastSeen = Date.now(); }, 15000);
        req.on('close', () => { clearInterval(heartbeat); member.streams.delete(res); member.lastSeen = Date.now(); room.touchedAt = Date.now(); if (rooms.has(room.id)) { if (!member.streams.size && controllerOf(room) === member.id) room.playback = { ...room.playback, time: currentTime(room), playing: false, updatedAt: Date.now() }; storage.save(room); broadcast(room); } });
        return;
      }
      if (req.method !== 'POST') fail('Desteklenmeyen istek.', 405);
      const member = auth(room, req);
      room.touchedAt = Date.now();
      if (action === 'upload') {
        if (!permissionsFor(room, member.id).addVideo && !permissionsFor(room, member.id).manageQueue) fail('Video ekleme yetkin yok.', 403);
        if (room.queue.length >= 50) fail('Listede en fazla 50 video olabilir.');
        const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
        if (!['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.mkv', '.m4v'].includes(ext)) fail('MP4, WebM, Ogg, MOV veya MKV video seç.');
        const length = Number(req.headers['content-length']); if (!Number.isSafeInteger(length) || length <= 0 || length > maxUpload) fail(`Dosya en fazla ${maxUpload / 1024 / 1024} MB olabilir.`, 413);
        if (usedStorage + reservedStorage + length > storageQuota) fail('Video depolama alanı dolu.', 507);
        reservedStorage += length;
        const id = randomUUID(); const target = path.join(uploadDir, id + ext); let size = 0;
        const limiter = new Transform({ transform(chunk, encoding, done) { size += chunk.length; if (size > length) done(new Error('Yükleme boyutu aşıldı.')); else done(null, chunk); } });
        try {
          await pipeline(req, limiter, createWriteStream(target, { flags: 'wx' }));
          if (rooms.get(room.id) !== room || room.closed) fail('Oda kapatıldı.', 410);
          if (room.queue.length >= 50) fail('Listede en fazla 50 video olabilir.');
          room.queue.push({ id, title: path.basename(url.searchParams.get('name')).slice(0, 120), url: `/uploads/${id}${ext}`, source: `${member.name} yükledi` });
          try { storage.save(room); } catch (err) { room.queue.pop(); throw err; }
          usedStorage += size;
        } catch (err) { await unlink(target).catch(() => {}); throw err; }
        finally { reservedStorage -= length; }
        broadcast(room); return json(res, 201, { ok: true });
      }
      const input = await body(req);
      if (action === 'message') {
        const text = String(input.text || '').trim().slice(0, 1000); if (!text) fail('Mesaj boş olamaz.');
        const previous = room.messages.findLast(m => m.memberId === member.id); if (previous && Date.now() - previous.at < 400) fail('Biraz yavaş, mesajın az sonra gönderilebilir.', 429);
        room.messages.push({ id: randomUUID(), memberId: member.id, name: member.name, text, at: Date.now() }); room.messages = room.messages.slice(-150);
      } else {
        if (action === 'permissions') { hostOnly(room, member); setPermissions(room, input.memberId, input.permissions); }
        if (action === 'video') { if (!permissionsFor(room, member.id).addVideo && !permissionsFor(room, member.id).manageQueue) fail('Video ekleme yetkin yok.', 403); if (room.queue.length >= 50) fail('Listede en fazla 50 video olabilir.'); const source = videoSource(input.url, input.kind); room.queue.push({ id: randomUUID(), title: String(input.title || 'Bağlantıdan eklenen video').slice(0, 120), ...source, source: `${member.name} ekledi` }); }
        if (action === 'select') { requirePermission(room, member, 'manageQueue'); if (!room.queue.some(v => v.id === input.videoId)) fail('Video bulunamadı.'); room.playback = { videoId: input.videoId, time: 0, playing: false, updatedAt: Date.now(), controller: member.id }; }
        if (action === 'remove-video') { requirePermission(room, member, 'manageQueue'); const item = room.queue.find(v => v.id === input.videoId); if (!item) fail('Video bulunamadı.'); if (room.queue.length === 1) fail('Listede en az bir video kalmalı.'); room.queue = room.queue.filter(v => v.id !== item.id); if (room.playback.videoId === item.id) room.playback = { videoId: room.queue[0].id, time: 0, playing: false, updatedAt: Date.now(), controller: member.id }; await releaseUpload(item.url); }
        if (action === 'playback') { requirePermission(room, member, 'playback'); if (!Number.isFinite(input.time) || input.time < 0) fail('Geçersiz oynatma zamanı.'); if (input.videoId && input.videoId !== room.playback.videoId || input.heartbeat && controllerOf(room) !== member.id) return json(res, 200, { ok: true }); room.playback = { ...room.playback, time: Math.min(input.time, 604800), playing: Boolean(input.playing), updatedAt: Date.now(), controller: member.id }; }
      }
      storage.save(room); broadcast(room); return json(res, 200, { ok: true });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') fail('Desteklenmeyen istek.', 405);
    let file;
    if (/^\/uploads\/[a-f0-9-]{36}\.(mp4|webm|ogg|ogv|mov|mkv|m4v)$/.test(url.pathname)) {
      const ownerRoom = [...rooms.values()].find(r => r.queue.some(item => item.url === url.pathname));
      if (!ownerRoom || !ownerRoom.members.has(hashToken(requestToken(req, ownerRoom)))) fail('Bu videoyu izlemek için odaya katılmalısın.', 401);
      res.setHeader('Cache-Control', 'private, no-store');
      file = path.join(uploadDir, path.basename(url.pathname));
    }
    else if (['/favicon.svg', '/message-queue.js', '/update-client.js', '/build-info.json', '/style.css', '/player.css', '/app.js', '/player.js', '/media-source.js', '/room-policy.js', '/admin.html', '/admin.css', '/admin.js', '/extension-client.js', '/extension-guide.html', '/birlikteizle-extension.zip'].includes(url.pathname) || /^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(url.pathname)) file = path.join(root, 'public', url.pathname.slice(1));
    else if (url.pathname === '/' || /^\/room\/([a-f0-9-]{8}|[a-f0-9-]{36})$/.test(url.pathname)) file = path.join(root, 'public', 'index.html');
    else fail('Sayfa bulunamadı.', 404);
    let info; try { info = await stat(file); } catch { fail('Dosya bulunamadı.', 404); }
    const types = { '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.zip': 'application/zip', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg', '.mov': 'video/quicktime' };
    const headers = { 'Content-Type': types[path.extname(file)], 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
    if (!url.pathname.startsWith('/uploads/')) headers['Cache-Control'] = url.pathname === '/build-info.json' ? 'no-store' : 'no-cache, max-age=0, must-revalidate';
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
      else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end - start + 1; res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  } catch (error) { const status = error.status || (error instanceof SyntaxError ? 400 : 500); if (status >= 500) console.error('Request failed:', error.code || error.name); if (!res.headersSent) json(res, status, { error: error.status || status === 400 ? error.message : 'Sunucu isteği tamamlayamadı.' }); else res.end(); }
});
let maintenanceRunning = false;
const cleanup = setInterval(async () => { if (maintenanceRunning) return; maintenanceRunning = true; try { const now = Date.now(); for (const [key, bucket] of rateBuckets) if (bucket.until < now) rateBuckets.delete(key); await cleanIdleRooms(); for (const room of rooms.values()) if ([...room.members.values()].some(m => m.streams.size)) storage.save(room); } catch (error) { console.error('Maintenance failed:', error.code || error.name); } finally { maintenanceRunning = false; } }, 60000);
cleanup.unref();
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 20000;
function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  for (const room of rooms.values()) { room.playback = { ...room.playback, time: currentTime(room), playing: false, updatedAt: Date.now() }; storage.save(room); for (const member of room.members.values()) for (const stream of member.streams) stream.end(); }
  server.close(() => { storage.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log(`▶ birlikteizle. hazır: http://localhost:${server.address().port}`));
