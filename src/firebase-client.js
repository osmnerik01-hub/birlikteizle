import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously, connectAuthEmulator, signOut } from 'firebase/auth';
import { getDatabase, ref, get, set, update, query, orderByValue, endAt, limitToFirst, onValue, onDisconnect, remove, push, serverTimestamp, runTransaction, connectDatabaseEmulator, goOffline } from 'firebase/database';
import { firebaseConfig } from '../public/firebase-config.js';
import { ROOM_NAMESPACE, makeRoom, roomSnapshot, queueSlot, messageSlot } from './room-model.js';
import { resolveMediaSource } from '../public/media-source.js';
import { permissionsFor, PERMISSIONS, controllerOf, IDLE_ROOM_TTL_MS } from '../public/room-policy.js';

function friendlyError(error) {
  const code = String(error.code || '').toLowerCase();
  if (code.includes('operation-not-allowed') || code.includes('admin-restricted-operation')) return new Error('Firebase konsolunda Authentication → Sign-in method → Anonymous girişini etkinleştir.');
  if (code.includes('permission-denied') || code.includes('permission_denied')) return new Error('İşlem reddedildi. Oda yetkilerin değişmiş veya oda kapatılmış olabilir. Sayfayı yenile.');
  if (code.includes('unauthorized-domain')) return new Error('Bu site adresini Firebase Authentication ayarlarındaki yetkili alan adlarına ekle.');
  if (code.includes('network')) return new Error('Firebase bağlantısı kurulamadı. İnternet bağlantını kontrol et.');
  return error;
}

export async function createFirebaseBackend(options = {}) {
  try {
    const app = initializeApp(options.config || firebaseConfig, options.appName);
    const auth = getAuth(app);
    if (options.emulators) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await auth.authStateReady();
    const user = auth.currentUser || (await signInAnonymously(auth)).user;
    const db = getDatabase(app);
    if (options.emulators) connectDatabaseEmulator(db, '127.0.0.1', 9000);
    let offset = 0;
    const stopOffset = onValue(ref(db, '.info/serverTimeOffset'), value => { offset = value.val() || 0; });
    const subscriptions = new Set();
    const cachedRooms = new Map();
    let disposed = false;
    const now = () => Date.now() + offset;
    const roomRef = (id, child = '') => ref(db, `${ROOM_NAMESPACE}/${id}${child ? `/${child}` : ''}`);
    const activityPaths = id => ({ [`${ROOM_NAMESPACE}/${id}/lifecycle/lastActiveAt`]: serverTimestamp(), [`roomIndex/${id}`]: serverTimestamp() });
    async function touch(id) { await update(ref(db), activityPaths(id)); }
    async function cleanupExpired() {
      const clockRef = ref(db, 'cleanupClock');
      let clock = (await get(clockRef)).val();
      if (!clock || now() - clock >= 60000) { try { await set(clockRef, serverTimestamp()); } catch (error) { if (!String(error.code).toLowerCase().includes('permission')) throw error; } clock = (await get(clockRef)).val(); }
      let candidates;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { candidates = await get(query(ref(db, 'roomIndex'), orderByValue(), endAt(clock - IDLE_ROOM_TTL_MS), limitToFirst(50))); break; }
        catch (error) { if (attempt) throw error; clock = (await get(clockRef)).val(); }
      }
      let removed = 0;
      for (const id of Object.keys(candidates.val() || {})) {
        try { await remove(roomRef(id)); await remove(ref(db, `roomIndex/${id}`)); removed++; }
        catch (error) { if (!String(error.code).toLowerCase().includes('permission_denied') && !String(error.code).toLowerCase().includes('permission-denied')) throw error; }
      }
      return { removed };
    }

    async function request(action, id, input = {}) {
      try {
        if (action === 'create') {
          const roomId = crypto.randomUUID();
          await set(roomRef(roomId), makeRoom(roomId, user.uid, input.title, serverTimestamp()));
          await set(ref(db, `roomIndex/${roomId}`), serverTimestamp());
          return { id: roomId };
        }
        if (action === 'join') {
          const meta = await get(roomRef(id, 'meta'));
          if (!meta.exists()) throw new Error('Bu oda bulunamadı. Yeni bir oda oluşturabilirsin.');
          await set(roomRef(id, `members/${user.uid}`), { id: user.uid, name: String(input.name || 'Misafir').trim().slice(0, 24) || 'Misafir' });
          await touch(id);
          const room = (await get(roomRef(id))).val();
          cachedRooms.set(id, room);
          return { token: '', memberId: user.uid, room: roomSnapshot(room, now()) };
        }
        const raw = cachedRooms.get(id) || (await get(roomRef(id))).val();
        if (!raw) throw new Error('Oda bulunamadı.');
        if (raw.closed) throw new Error('Bu oda yönetici tarafından kapatılmış.');
        const permissions = permissionsFor(raw, user.uid);
        if (action === 'message') {
          const text = String(input.text || '').trim().slice(0, 1000);
          if (!text) throw new Error('Mesaj boş olamaz.');
          const messageId = crypto.randomUUID();
          let messages = raw.messages || {};
          for (let attempt = 0; attempt < 16; attempt++) {
            const slot = messageSlot(messages);
            const previousId = messages[slot]?.id || null;
            const result = await runTransaction(roomRef(id, `messages/${slot}`), current => {
              // A transaction may initially receive null before its server value is cached.
              // Propose the write so Firebase can retry with the authoritative value.
              if (current && current.id !== previousId) return;
              return { id: messageId, memberId: user.uid, name: raw.members[user.uid].name, text, at: serverTimestamp() };
            }, { applyLocally: false });
            if (result.committed) return { ok: true };
            await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 40));
            messages = (await get(roomRef(id, 'messages'))).val() || {};
          }
          throw new Error('Mesaj gönderilemedi. Yeniden dene.');
        }
        if (action === 'permissions') {
          if (raw.meta.host !== user.uid) throw new Error('Yetkileri yalnızca oda sahibi değiştirebilir.');
          if (!raw.members?.[input.memberId]) throw new Error('Katılımcı bulunamadı.');
          const value = Object.fromEntries(Object.keys(PERMISSIONS).map(key => [key, input.permissions?.[key] === true]));
          const changes = { [`permissions/${input.memberId}`]: value };
          if (controllerOf(raw) === input.memberId && !value.playback) changes.playback = { ...raw.playback, time: roomSnapshot(raw, now()).playback.time, playing: false, updatedAt: serverTimestamp(), controller: controllerOf(raw) };
          await update(roomRef(id), changes); return { ok: true };
        }
        if (action === 'video') {
          if (!permissions.addVideo && !permissions.manageQueue) throw new Error('Video ekleme yetkin yok. Oda sahibinden izin iste.');
          const { url, kind } = resolveMediaSource(input.url, input.kind);
          if (!url.startsWith('https:')) throw new Error('İnternet sürümünde HTTPS bağlantısı kullan.');
          let queue = raw.queue || {};
          for (let attempt = 0; attempt < 4; attempt++) {
            const slot = queueSlot(queue);
            const result = await runTransaction(roomRef(id, `queue/${slot}`), current => current ? undefined : {
              id: slot, title: String(input.title || 'Bağlantıdan eklenen video').slice(0, 120), url, kind,
              source: `${raw.members[user.uid].name} ekledi`, order: serverTimestamp()
            }, { applyLocally: false });
            if (result.committed) return { ok: true };
            queue = (await get(roomRef(id, 'queue'))).val() || {};
          }
          throw new Error('Video eklenemedi. Yeniden dene.');
        }
        if (action === 'select') {
          if (!permissions.manageQueue) throw new Error('Listeyi yönetme yetkin yok.');
          if (!raw.queue?.[input.videoId]) throw new Error('Video bulunamadı.');
          await set(roomRef(id, 'playback'), { videoId: input.videoId, time: 0, playing: false, updatedAt: serverTimestamp(), controller: user.uid });
        } else if (action === 'remove-video') {
          if (!permissions.manageQueue) throw new Error('Listeyi yönetme yetkin yok.');
          if (!raw.queue?.[input.videoId]) throw new Error('Video bulunamadı.');
          const changes = { [`queue/${input.videoId}`]: null };
          if (raw.playback.videoId === input.videoId) {
            const nextId = Object.keys(raw.queue).find(key => key !== input.videoId);
            if (!nextId) throw new Error('Listede en az bir video kalmalı.');
            changes.playback = { videoId: nextId, time: 0, playing: false, updatedAt: serverTimestamp(), controller: user.uid };
          }
          await update(roomRef(id), changes);
        } else if (action === 'playback') {
          if (!permissions.playback) throw new Error('Oynatma yetkin yok. Oda sahibinden izin iste.');
          if (!Number.isFinite(input.time) || input.time < 0 || input.time > 604800) throw new Error('Geçersiz oynatma konumu.');
          await runTransaction(roomRef(id, 'playback'), current => {
            if (!current || input.videoId && input.videoId !== current.videoId || input.heartbeat && (current.controller || raw.meta.host) !== user.uid) return;
            return { videoId: current.videoId, time: input.time, playing: Boolean(input.playing), updatedAt: serverTimestamp(), controller: user.uid };
          }, { applyLocally: false });
        } else throw new Error('Bu işlem Firebase sürümünde desteklenmiyor.');
        return { ok: true };
      } catch (error) { throw friendlyError(error); }
    }

    function subscribe(id, receive, status, onError) {
      let active = true, latest, presence, disconnect;
      let presenceWork = Promise.resolve();
      const fail = error => { if (active) onError(friendlyError(error)); };
      const emit = () => { if (active && latest) receive(roomSnapshot(latest, now())); };
      const stopRoom = onValue(roomRef(id), snapshot => { latest = snapshot.val(); if (!latest) return fail(new Error('Oda bulunamadı.')); cachedRooms.set(id, latest); emit(); }, fail);
      const stopConnected = onValue(ref(db, '.info/connected'), snapshot => {
        const connected = snapshot.val() === true;
        status(connected);
        if (!connected) return;
        presenceWork = presenceWork.then(async () => {
          if (!active) return;
          if (presence) await remove(presence);
          if (disconnect) await disconnect.cancel();
          presence = push(roomRef(id, `presence/${user.uid}`));
          const presenceDisconnect = onDisconnect(presence);
          const activityDisconnect = onDisconnect(roomRef(id, 'lifecycle/lastActiveAt'));
          const indexDisconnect = onDisconnect(ref(db, `roomIndex/${id}`));
          disconnect = { cancel: () => Promise.all([presenceDisconnect.cancel(), activityDisconnect.cancel(), indexDisconnect.cancel()]) };
          await presenceDisconnect.remove();
          await activityDisconnect.set(serverTimestamp());
          await indexDisconnect.set(serverTimestamp());
          if (active) { await set(presence, true); await touch(id); }
          else { await disconnect.cancel(); await remove(presence); }
        }).catch(fail);
      }, fail);
      // Re-evaluate heartbeat expiry even when the host vanishes without a write.
      const timer = setInterval(emit, 2000);
      const activityTimer = setInterval(() => { if (active && latest && now() - (latest.lifecycle?.lastActiveAt || 0) > 120000) touch(id).catch(fail); }, 60000);
      const subscription = { close() {
        active = false; clearInterval(timer); clearInterval(activityTimer); stopRoom(); stopConnected();
        subscriptions.delete(subscription);
        return presenceWork.then(async () => { if (presence) { await update(ref(db), { [`${ROOM_NAMESPACE}/${id}/presence/${user.uid}/${presence.key}`]: null, ...activityPaths(id) }); } if (disconnect) await disconnect.cancel(); }).catch(() => {});
      } };
      subscriptions.add(subscription);
      return subscription;
    }
    return { request, subscribe, cleanupExpired, async dispose() { if (disposed) return; disposed = true; await Promise.all([...subscriptions].map(s => s.close())); stopOffset(); goOffline(db); await signOut(auth); await deleteApp(app); } };
  } catch (error) { throw friendlyError(error); }
}
