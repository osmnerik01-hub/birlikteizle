export const IDLE_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const PERMISSIONS = { addVideo: 'Video ekleme', manageQueue: 'Listeyi yönetme', playback: 'Oynatma ve durdurma' };
export function permissionsFor(room, uid) {
  const owner = Boolean(uid && (room?.host || room?.meta?.host) === uid);
  return Object.fromEntries(Object.keys(PERMISSIONS).map(key => [key, owner || room?.permissions?.[uid]?.[key] === true]));
}
export function controllerOf(room) { return room?.playback?.controller || room?.host || room?.meta?.host; }
export function idleRoom(raw, now = Date.now()) {
  const presence = Object.values(raw?.presence || {}).some(connections => Object.keys(connections || {}).length);
  const lastActive = raw?.lifecycle?.lastActiveAt || raw?.meta?.createdAt || now;
  return !presence && now - lastActive >= IDLE_ROOM_TTL_MS;
}
