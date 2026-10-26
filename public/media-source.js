export function resolveMediaSource(value, hint) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Geçerli bir video veya web sayfası bağlantısı gir.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('Kullanıcı bilgisi içermeyen bir HTTP veya HTTPS bağlantısı kullan.');
  const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const inferred = extension === 'm3u8' ? 'hls' : extension === 'mpd' ? 'dash' : ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'mkv', 'm4v'].includes(extension) ? 'video' : 'page';
  const kind = ['video', 'hls', 'dash'].includes(hint) ? hint : inferred;
  return { url: url.href, kind };
}

export function timeLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const value = Math.floor(seconds), hours = Math.floor(value / 3600);
  return `${hours ? `${hours}:` : ''}${hours ? String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function normalizeTracks(tracks, prefix) {
  return Array.from(tracks || []).map((track, index) => ({
    id: String(track.id ?? index), index,
    label: String(track.label || track.name || track.lang || track.language || `${prefix} ${index + 1}`).slice(0, 100),
    language: String(track.lang || track.language || ''),
    active: Boolean(track.enabled || track.mode === 'showing' || track.active)
  }));
}
