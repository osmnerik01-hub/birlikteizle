import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, ref, get, set, update, remove, query, orderByValue, endAt, endBefore, limitToFirst, limitToLast, serverTimestamp, runTransaction, connectDatabaseEmulator } from 'firebase/database';
import { firebaseConfig } from '../public/firebase-config.js';
import { ROOM_NAMESPACE, roomSnapshot } from './room-model.js';
import { idleRoom, PERMISSIONS } from '../public/room-policy.js';

export function createAdminBackend(options = {}) {
  // A separate Auth instance keeps the viewer's anonymous room identity intact.
  const app = initializeApp(options.config || firebaseConfig, options.appName || 'birlikte-site-admin');
  const auth = getAuth(app), db = getDatabase(app);
  if (options.emulators) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectDatabaseEmulator(db, '127.0.0.1', 9000); }
  const roomRef = (id, child = '') => ref(db, `${ROOM_NAMESPACE}/${id}${child ? `/${child}` : ''}`);
  let authorized = false;
  const requireAdmin = () => { if (!authorized) throw new Error('Bu hesap admin olarak yetkilendirilmemiş.'); };
  async function check() {
    authorized = false;
    if (!auth.currentUser) return { signedIn: false, admin: false };
    try { await get(ref(db, 'siteConfig')); authorized = true; } catch { /* Database rules are authoritative. */ }
    return { signedIn: true, admin: authorized, email: auth.currentUser.email };
  }
  return {
    async login() {
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider); return check();
    },
    async logout() { authorized = false; await signOut(auth); },
    watchIdentity(receive) { return onAuthStateChanged(auth, () => check().then(receive)); },
    async listRooms(cursor) {
      requireAdmin();
      const constraints = [orderByValue()];
      if (cursor) constraints.push(endBefore(cursor.at, cursor.id));
      constraints.push(limitToLast(50));
      const index = (await get(query(ref(db, 'roomIndex'), ...constraints))).val() || {};
      const entries = Object.entries(index).sort((a,b) => b[1] - a[1] || b[0].localeCompare(a[0]));
      const rooms = [];
      // Fetch metadata only, never every room's chat, queue and members at once.
      for (let start = 0; start < entries.length; start += 10) {
        const batch = await Promise.all(entries.slice(start, start + 10).map(async ([id, lastActiveAt]) => {
          const meta = (await get(roomRef(id, 'meta'))).val(); return meta ? { ...meta, lastActiveAt } : null;
        })); rooms.push(...batch.filter(Boolean));
      }
      const last = entries.at(-1);
      return { rooms, cursor: entries.length === 50 ? { id: last[0], at: last[1] } : null };
    },
    async room(id) { requireAdmin(); const raw = (await get(roomRef(id))).val(); return { raw, room: roomSnapshot(raw, Date.now()) }; },
    async action(id, action, input = {}) {
      requireAdmin();
      if (action === 'delete') { await update(ref(db), { [`${ROOM_NAMESPACE}/${id}`]: null, [`roomIndex/${id}`]: null }); return; }
      const raw = (await get(roomRef(id))).val();
      if (!raw) throw new Error('Oda artık bulunmuyor.');
      if (action === 'closed') await set(roomRef(id, 'closed'), input.closed === true);
      else if (action === 'rename') { const title = String(input.title || '').trim().slice(0, 70); if (!title) throw new Error('Oda adı boş olamaz.'); await set(roomRef(id, 'meta/title'), title); }
      else if (action === 'clear-chat') await remove(roomRef(id, 'messages'));
      else if (action === 'host') { if (!raw.members?.[input.memberId]) throw new Error('Katılımcı bulunamadı.'); const changes = { 'meta/host': input.memberId }; if (!raw.closed) changes.playback = { ...raw.playback, time: roomSnapshot(raw, Date.now()).playback.time, playing: false, updatedAt: serverTimestamp(), controller: auth.currentUser.uid }; await update(roomRef(id), changes); }
      else if (action === 'pause') await set(roomRef(id, 'playback'), { ...raw.playback, time: roomSnapshot(raw, Date.now()).playback.time, playing: false, updatedAt: serverTimestamp(), controller: auth.currentUser.uid });
      else if (action === 'permissions') {
        if (!raw.members?.[input.memberId]) throw new Error('Katılımcı bulunamadı.');
        const value = Object.fromEntries(Object.keys(PERMISSIONS).map(key => [key, input.permissions?.[key] === true]));
        const changes = { [`permissions/${input.memberId}`]: value };
        if ((raw.playback.controller || raw.meta.host) === input.memberId && !value.playback) changes.playback = { ...raw.playback, time: roomSnapshot(raw, Date.now()).playback.time, playing: false, updatedAt: serverTimestamp(), controller: auth.currentUser.uid };
        await update(roomRef(id), changes);
      } else throw new Error('Desteklenmeyen yönetim işlemi.');
    },
    async cleanup() {
      requireAdmin(); let removed = 0;
      // Bounded pages, with a transaction recheck so an arriving viewer is protected.
      const index = (await get(query(ref(db, 'roomIndex'), orderByValue(), endAt(Date.now() - 86400000), limitToFirst(50)))).val() || {};
      for (const id of Object.keys(index).filter(id => index[id] <= Date.now() - 86400000)) {
        const result = await runTransaction(roomRef(id), raw => !raw ? null : idleRoom(raw) ? null : undefined, { applyLocally: false });
        if (result.committed) { await remove(ref(db, `roomIndex/${id}`)); removed++; }
      }
      return { removed };
    }
  };
}
