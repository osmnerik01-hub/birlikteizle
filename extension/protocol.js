export const APP_ORIGINS = new Set(['https://your-firebase-project.web.app', 'https://your-firebase-project.firebaseapp.com', 'http://localhost:3000', 'http://127.0.0.1:3000']);
export function isAppUrl(url) { try { return APP_ORIGINS.has(new URL(url).origin); } catch { return false; } }
export function sourceUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isAppUrl(url.href) || url.href.length > 2048) throw new Error('Geçerli bir kaynak sayfası seç.');
  return url.href;
}
const bounded = (value, min, max, fallback = 0) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function cleanState(value = {}) {
  const tracks = list => Array.isArray(list) ? list.slice(0, 40).map((t, index) => ({ id: String(t.id ?? index).slice(0, 80), label: String(t.label || t.language || `Kayıt ${index + 1}`).slice(0, 100), active: Boolean(t.active) })) : [];
  return {
    playerId: String(value.playerId || '').slice(0, 80), title: String(value.title || 'Kaynak video').slice(0, 120),
    time: bounded(value.time, 0, 604800), duration: bounded(value.duration, 0, 604800), playing: Boolean(value.playing),
    volume: bounded(value.volume, 0, 1, 1), muted: Boolean(value.muted), area: bounded(value.area, 0, 100000000),
    audio: tracks(value.audio), subtitles: tracks(value.subtitles), userAction: Boolean(value.userAction),
    drm: Boolean(value.drm), ready: Boolean(value.ready), buffering: Boolean(value.buffering), seeking: Boolean(value.seeking)
  };
}
export function cleanCommand(value = {}) {
  if (value.action === 'playback') {
    if (!Number.isFinite(value.time) || value.time < 0 || value.time > 604800 || typeof value.playing !== 'boolean') throw new Error('Geçersiz oynatma komutu.');
    return { action: 'playback', time: value.time, playing: value.playing };
  }
  if (value.action === 'volume') return { action: 'volume', volume: bounded(value.volume, 0, 1, 1), muted: Boolean(value.muted) };
  if (['audio', 'subtitle'].includes(value.action)) return { action: value.action, id: String(value.id ?? '').slice(0, 80) };
  throw new Error('Desteklenmeyen oynatıcı komutu.');
}
