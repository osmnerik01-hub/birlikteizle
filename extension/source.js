(() => {
  if (globalThis.__birlikteDetector) return;
  globalThis.__birlikteDetector = true;
  const players = new Map(), reportedAt = new Map(), commandedSeeks = new WeakSet(); let active = false, suppressUntil = 0, lastSent = 0;
  const providerTracks = new Map(), providerRequests = new Map(), inspectedAt = new Map();
  const providerRequest = (playerId, action, id) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID(), timer = setTimeout(() => { providerRequests.delete(requestId); resolve(null); }, 700);
    providerRequests.set(requestId, { resolve, reject, timer });
    window.postMessage({ source: 'birlikte-provider-request', requestId, playerId, action, id }, '*');
  });
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'birlikte-provider-response') return;
    const pending = providerRequests.get(event.data.requestId); if (!pending) return;
    clearTimeout(pending.timer); providerRequests.delete(event.data.requestId);
    if (event.data.result?.ok) pending.resolve(event.data.result); else pending.reject(new Error(event.data.result?.error || 'Kaynak menüsü yanıt vermedi.'));
  });
  let disconnected = false;
  const send = async message => {
    if (disconnected) return;
    try {
      if (!chrome.runtime?.id) { disconnected = true; active = false; roomButton?.remove(); return; }
      return await chrome.runtime.sendMessage({ source: 'birlikte-source', ...message });
    }
    catch (error) {
      if (/context invalidated/i.test(error?.message || '')) {
        disconnected = true; active = false; roomButton?.remove();
      }
    }
  };
  function findVideos(root = document) {
    const list = [...root.querySelectorAll('video')];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) list.push(...findVideos(el.shadowRoot));
    return list;
  }
  let roomButton;
  function showRoomButton() {
    if (window !== window.top || roomButton?.isConnected || !document.documentElement) return;
    roomButton = document.createElement('div');
    roomButton.style.cssText = 'all:initial;position:fixed;top:12px;left:12px;z-index:2147483647';
    const shadow = roomButton.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<style>button{font:600 13px system-ui;color:#f4eafd;background:#251632ed;border:1px solid #ac8bc4;border-radius:9px;padding:10px 14px;cursor:pointer;box-shadow:0 4px 20px #0006}button:hover{background:#49305e}button:focus-visible{outline:3px solid #e1c4ff}</style><button type="button">↗ Odaya dön · Birlikte İzle</button>';
    shadow.querySelector('button').onclick = () => send({ action: 'FOCUS_ROOM' });
    document.documentElement.append(roomButton);
  }
  function describe(video, playerId, userAction = false) {
    const rect = video.getBoundingClientRect();
    const tracks = (list, subtitle) => Array.from(list || []).map((t, i) => ({ id: String(i), label: t.label || t.language || `${subtitle ? 'Altyazı' : 'Ses'} ${i + 1}`, active: subtitle ? t.mode === 'showing' : Boolean(t.enabled) }));
    const nativeAudio = tracks(video.audioTracks, false), nativeSubtitles = tracks(video.textTracks, true), provider = providerTracks.get(playerId);
    return { playerId, title: document.title, sampledAt: Date.now(), time: video.currentTime || 0, duration: Number.isFinite(video.duration) ? video.duration : 0, playing: !video.paused && !video.ended, buffering: !video.paused && video.readyState < 3, seeking: Boolean(video.seeking), volume: video.volume, muted: video.muted, area: rect.width * rect.height, audio: provider?.audio?.length > nativeAudio.length ? provider.audio : nativeAudio, subtitles: provider?.subtitles?.length > nativeSubtitles.length ? provider.subtitles : nativeSubtitles, userAction: userAction && !commandedSeeks.has(video) && Date.now() > suppressUntil, drm: Boolean(video.mediaKeys), ready: video.readyState > 0 };
  }
  function report(video, id, userAction = false) {
    if (!active || !video.isConnected) return;
    reportedAt.set(id, Date.now());
    send({ action: 'STATE', state: describe(video, id, userAction) });
    if (Date.now() - (inspectedAt.get(id) || 0) > 3000) {
      inspectedAt.set(id, Date.now());
      providerRequest(id, 'inspect').then(result => { if (result) { providerTracks.set(id, result); if (active && video.isConnected) send({ action: 'STATE', state: describe(video, id) }); } }).catch(() => {});
    }
  }
  function scan() {
    if (!active) return;
    showRoomButton();
    for (const video of findVideos().slice(0, 10)) {
      if ([...players.values()].includes(video)) continue;
      const id = crypto.randomUUID(); players.set(id, video); video.dataset.birliktePlayer = id;
      for (const type of ['play', 'pause', 'ended', 'seeked', 'seeking', 'waiting', 'playing', 'loadedmetadata', 'volumechange', 'encrypted']) video.addEventListener(type, () => {
        report(video, id, ['play', 'pause', 'ended', 'seeked'].includes(type));
        if (type === 'seeked' && commandedSeeks.has(video)) {
          commandedSeeks.delete(video); suppressUntil = Date.now() + 1500;
        }
      });
      video.addEventListener('timeupdate', () => { if (Date.now() - (reportedAt.get(id) || 0) > 1000) report(video, id); });
      report(video, id);
    }
    for (const [id, video] of players) if (!video.isConnected) { players.delete(id); providerTracks.delete(id); inspectedAt.delete(id); }
  }
  function start() { if (active) return; active = true; scan(); }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.source !== 'birlikte-extension') return;
    if (message.action === 'STOP') { active = false; roomButton?.remove(); for (const video of players.values()) { video.pause(); delete video.dataset.birliktePlayer; } players.clear(); providerTracks.clear(); respond({ ok: true }); return; }
    if (message.action !== 'COMMAND' || !active) return;
    const video = players.get(message.playerId);
    if (!video?.isConnected) { respond({ ok: false, error: 'Kaynak oynatıcı artık sayfada değil. Videoyu yeniden başlat.' }); return; }
    (async () => {
      suppressUntil = Date.now() + 1500;
      const command = message.command;
      if (command.action === 'playback') {
        if (video.readyState >= 1 && Math.abs(video.currentTime - command.time) > 1.2) {
          commandedSeeks.add(video); video.currentTime = command.time;
          // Some players complete a seek synchronously without dispatching seeked.
          if (!video.seeking) commandedSeeks.delete(video);
        }
        if (command.playing) { if (video.paused) await video.play(); } else video.pause();
      } else if (command.action === 'volume') { video.volume = command.volume; video.muted = command.muted; }
      else if (command.action === 'audio') {
        if (String(command.id).startsWith('api:')) {
          const result = await providerRequest(message.playerId, 'audio', command.id); if (!result) throw new Error('Kaynak ses menüsü yanıt vermedi.'); providerTracks.set(message.playerId, result);
          report(video, message.playerId); return { ok: true };
        }
        const tracks = Array.from(video.audioTracks || []), index = Number(command.id);
        if (!tracks[index]) throw new Error('Kaynak oynatıcı ses kayıtlarını tarayıcıya açmıyor. Kaynak sayfadaki ses menüsünü kullan.');
        tracks.forEach((track, i) => track.enabled = i === index);
      } else if (command.action === 'subtitle') {
        if (String(command.id).startsWith('api:') || command.id === 'off' && providerTracks.get(message.playerId)?.subtitles?.length) {
          const result = await providerRequest(message.playerId, 'subtitle', command.id); if (!result) throw new Error('Kaynak altyazı menüsü yanıt vermedi.'); providerTracks.set(message.playerId, result);
          Array.from(video.textTracks || []).forEach(track => { if (command.id === 'off') track.mode = 'disabled'; });
          report(video, message.playerId); return { ok: true };
        }
        const tracks = Array.from(video.textTracks || []), index = Number(command.id);
        if (command.id !== 'off' && !tracks[index]) throw new Error('Altyazı kaydı bulunamadı.');
        tracks.forEach((track, i) => track.mode = command.id !== 'off' && i === index ? 'showing' : 'disabled');
      }
      report(video, message.playerId); return { ok: true };
    })().then(respond, error => respond({ ok: false, error: error.message || 'Kaynak sekmede oynat tuşuna bir kez basman gerekiyor.' }));
    return true;
  });
  new MutationObserver(() => { if (active && Date.now() - lastSent > 1000) { lastSent = Date.now(); scan(); } }).observe(document, { subtree: true, childList: true });
  setInterval(() => { if (!active) return; scan(); for (const [id, video] of players) report(video, id); }, 1500);
  send({ action: 'HELLO' }).then(response => { if (response?.watching) start(); });
})();
