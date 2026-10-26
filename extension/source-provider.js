(() => {
  if (window.__birlikteProvider) return;
  window.__birlikteProvider = true;
  const list = (tracks, selected, skipOff = false) => Array.from(tracks || []).map((track, index) => ({ id: `api:${index}`, label: String(track.label || track.name || track.lang || track.language || `Kayıt ${index + 1}`).slice(0, 100), active: selected === index })).filter((_, index) => !skipOff || index > 0).slice(0, 40);
  function videoFor(id, root = document) {
    const direct = root.querySelector(`[data-birlikte-player="${id}"]`);
    if (direct) return direct;
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) { const found = videoFor(id, element.shadowRoot); if (found) return found; }
    return null;
  }
  function adapter(video) {
    if (window.videojs?.getPlayers) {
      for (const player of Object.values(window.videojs.getPlayers())) if (player?.el?.()?.contains(video)) return {
        inspect: () => ({ audio: Array.from(player.audioTracks() || []).map((track, index) => ({ id: `api:${index}`, label: track.label || track.language || `Ses ${index + 1}`, active: Boolean(track.enabled) })), subtitles: Array.from(player.textTracks() || []).map((track, index) => ({ id: `api:${index}`, label: track.label || track.language || `Altyazı ${index + 1}`, active: track.mode === 'showing' })) }),
        audio: index => { const tracks = Array.from(player.audioTracks()); if (!tracks[index]) throw new Error('Ses kaydı bulunamadı.'); tracks.forEach((t, i) => t.enabled = i === index); },
        subtitle: index => { const tracks = Array.from(player.textTracks()); if (index >= 0 && !tracks[index]) throw new Error('Altyazı bulunamadı.'); tracks.forEach((t, i) => t.mode = index === i ? 'showing' : 'disabled'); }
      };
    }
    if (typeof window.jwplayer === 'function') {
      const player = window.jwplayer();
      if (player?.getContainer?.()?.contains(video)) return {
        inspect: () => ({ audio: list(player.getAudioTracks?.(), player.getCurrentAudioTrack?.()), subtitles: list(player.getCaptionsList?.(), player.getCurrentCaptions?.(), true) }),
        audio: index => player.setCurrentAudioTrack(index), subtitle: index => player.setCurrentCaptions(index < 0 ? 0 : index)
      };
    }
    for (const player of [window.hls, window.hlsPlayer]) if (player?.media === video && Array.isArray(player.audioTracks)) return {
      inspect: () => ({ audio: list(player.audioTracks, player.audioTrack), subtitles: list(player.subtitleTracks, player.subtitleDisplay ? player.subtitleTrack : -1) }),
      audio: index => { if (!player.audioTracks[index]) throw new Error('Ses kaydı bulunamadı.'); player.audioTrack = index; },
      subtitle: index => { if (index >= 0 && !player.subtitleTracks[index]) throw new Error('Altyazı bulunamadı.'); player.subtitleTrack = index; player.subtitleDisplay = index >= 0; }
    };
    for (const player of [window.player, window.dashPlayer]) if (typeof player?.getVideoElement === 'function' && player.getVideoElement() === video && typeof player.getTracksFor === 'function') return {
      inspect: () => { const audio = player.getTracksFor('audio'), text = player.getTracksFor('text'); return { audio: list(audio, audio.indexOf(player.getCurrentTrackFor('audio'))), subtitles: list(text, player.isTextEnabled() ? text.indexOf(player.getCurrentTrackFor('text')) : -1) }; },
      audio: index => { const track = player.getTracksFor('audio')[index]; if (!track) throw new Error('Ses kaydı bulunamadı.'); player.setCurrentTrack(track); },
      subtitle: index => { player.enableText(index >= 0); if (index >= 0) { const track = player.getTracksFor('text')[index]; if (!track) throw new Error('Altyazı bulunamadı.'); player.setCurrentTrack(track); } }
    };
    return null;
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.source !== 'birlikte-provider-request' || !/^[a-f0-9-]{36}$/.test(message.playerId || '') || !/^[a-f0-9-]{36}$/.test(message.requestId || '') || !['inspect', 'audio', 'subtitle'].includes(message.action)) return;
    try {
      const video = videoFor(message.playerId), player = video && adapter(video);
      let result = { ok: true, audio: [], subtitles: [] };
      if (player) {
        if (message.action !== 'inspect') {
          if (message.id !== 'off' && !/^api:([0-9]|[1-3][0-9])$/.test(message.id || '')) throw new Error('Geçersiz kayıt seçimi.');
          player[message.action](message.id === 'off' ? -1 : Number(message.id.slice(4)));
        }
        result = { ok: true, ...player.inspect() };
      } else if (message.action !== 'inspect') throw new Error('Kaynak oynatıcı kayıt seçimini açmıyor. Kaynak sayfadaki menüyü kullan.');
      window.postMessage({ source: 'birlikte-provider-response', requestId: message.requestId, result }, '*');
    } catch (error) { window.postMessage({ source: 'birlikte-provider-response', requestId: message.requestId, result: { ok: false, error: String(error.message || 'Kaynak oynatıcı yanıt vermedi.').slice(0, 180) } }, '*'); }
  });
})();
