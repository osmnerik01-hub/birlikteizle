import { resolveMediaSource } from '../public/media-source.js';
import { permissionsFor, controllerOf } from '../public/room-policy.js';
export const ROOM_NAMESPACE = 'birlikteRooms';
export const sampleVideo = { id: '0', title: 'Küçük bir bahar molası', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm', source: 'Örnek video · MDN / CC0', order: 0 };

export function makeRoom(id, uid, title, timestamp) {
  return {
    meta: { id, title: String(title || 'Birlikte güzel bir akşam').slice(0, 70), host: uid, createdAt: timestamp },
    members: { [uid]: { id: uid, name: 'Misafir' } },
    queue: { 0: { ...sampleVideo } },
    lifecycle: { lastActiveAt: timestamp },
    playback: { videoId: '0', time: 0, playing: false, updatedAt: timestamp, controller: uid }
  };
}

export function roomSnapshot(raw, serverNow) {
  if (!raw?.meta || !raw.playback) throw new Error('Bu oda bulunamadı. Yeni bir oda oluşturabilirsin.');
  const controller = controllerOf(raw);
  const activeHost = Object.keys(raw.presence?.[controller] || {}).length > 0 && permissionsFor(raw, controller).playback;
  // A vanished host cannot leave everyone playing forever. The last heartbeat
  // is authoritative; only allow two heartbeat periods of extrapolation.
  const elapsed = Math.max(0, Math.min(8, (serverNow - raw.playback.updatedAt) / 1000));
  const playing = raw.playback.playing && activeHost && elapsed < 8 && !raw.closed;
  return {
    ...raw.meta,
    closed: raw.closed === true, permissions: raw.permissions || {},
    members: Object.values(raw.members || {}).filter(person => Object.keys(raw.presence?.[person.id] || {}).length > 0),
    queue: Object.values(raw.queue || {}).sort((a, b) => a.order - b.order || Number(a.id) - Number(b.id)),
    messages: Object.values(raw.messages || {}).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-150),
    playback: { ...raw.playback, playing, time: raw.playback.time + (raw.playback.playing ? elapsed : 0), updatedAt: serverNow }
  };
}

export function directVideoUrl(value) {
  const source = resolveMediaSource(value);
  if (source.kind === 'page' || !source.url.startsWith('https:')) throw new Error('HTTPS ile başlayan doğrudan video veya yayın bağlantısı kullan.');
  return source.url;
}

export function queueSlot(queue = {}) {
  for (let slot = 0; slot < 50; slot++) if (!queue[slot]) return String(slot);
  throw new Error('İzleme listesinde en fazla 50 video olabilir.');
}

export function messageSlot(messages = {}) {
  for (let slot = 0; slot < 150; slot++) if (!messages[slot]) return String(slot);
  return Object.entries(messages).sort((a, b) => a[1].at - b[1].at)[0][0];
}
