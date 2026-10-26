import Hls from 'hls.js';
import { ExtensionClient } from '../public/extension-client.js';
import { resolveMediaSource, timeLabel, normalizeTracks } from '../public/media-source.js';
import { playbackAt } from '../extension/playback.js';

const option = (id, label) => { const el = document.createElement('option'); el.value = id; el.textContent = label; return el; };

export class WatchPlayer {
  constructor(video, { canControl, isLeader = canControl, onPlayback, onError, onNotice }) {
    this.video = video; this.stage = video.parentElement; this.canControl = canControl;
    this.isLeader = isLeader;
    this.onPlayback = onPlayback; this.onError = onError; this.onNotice = onNotice;
    this.kind = 'video'; this.remote = null; this.desired = null; this.suppressUntil = 0; this.keyboard = false; this.generation = 0;
    video.controls = false; video.removeAttribute('controls');
    this.stage.tabIndex = 0; this.stage.setAttribute('aria-label', 'Video oynatıcı');
    const controls = document.createElement('div'); controls.className = 'player-controls';
    controls.innerHTML = '<input class="player-timeline" type="range" min="0" max="1000" value="0" step="1" aria-label="Video konumu"><div class="player-buttons"><button class="player-toggle" type="button" aria-label="Oynat">▶</button><button class="player-back" type="button" aria-label="10 saniye geri">↶<small>10</small></button><button class="player-forward" type="button" aria-label="10 saniye ileri">↷<small>10</small></button><button class="player-mute" type="button" aria-label="Sesi kapat">◖))</button><input class="player-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Ses seviyesi"><span class="player-time">0:00 / 0:00</span><div class="player-spacer"></div><label class="track-label">Ses<select class="player-audio" aria-label="Ses kaydı"><option value="">Kaynakta tek ses</option></select></label><label class="track-label">Altyazı<select class="player-subtitle" aria-label="Altyazı"><option value="off">Kapalı</option></select></label><button class="player-fullscreen" type="button" aria-label="Tam ekran">⛶</button></div>';
    this.controls = controls; this.stage.append(controls);
    this.timeline = controls.querySelector('.player-timeline'); this.toggle = controls.querySelector('.player-toggle');
    this.audio = controls.querySelector('.player-audio'); this.subtitle = controls.querySelector('.player-subtitle');
    this.volume = controls.querySelector('.player-volume'); this.mute = controls.querySelector('.player-mute');
    this.panel = document.createElement('div'); this.panel.className = 'source-panel'; this.panel.hidden = true;
    this.panel.innerHTML = '<span class="source-symbol">↗</span><h2>Kaynak penceresinde birlikte izle</h2><p class="source-description">Video kendi sitesinde, ayrı bir pencerede oynar. Buradaki kontrollerle oynatmayı ve konumunu yönetebilirsin. Arkadaşın da aynı sayfayı kendi penceresinde açmalı.</p><div class="source-progress"><strong class="source-position">0:00</strong><span class="source-duration">/ 0:00</span><span class="source-sync">Bağlantı bekleniyor</span></div><button class="button primary source-open" type="button">Kaynak penceresini aç</button><a class="extension-guide" href="/extension-guide.html" target="_blank" rel="noopener">Chrome eklentisi kurulumu ↗</a><p class="source-status" role="status">Pencereyi açıp kaynak oynatıcıda videoyu bir kez başlat.</p>';
    this.stage.append(this.panel);
    this.panel.querySelector('.source-open').onclick = () => this.openSource();
    this.extension = new ExtensionClient();
    this.extension.addEventListener('SOURCE_STATE', event => this.acceptRemote(event.detail));
    this.extension.addEventListener('SOURCE_CLOSED', event => { if (this.kind !== 'page' || event.detail?.pageUrl !== this.source?.url) return; const time = this.currentTime; this.remote = null; this.panel.querySelector('.source-open').textContent = 'Kaynak penceresini aç'; this.panel.querySelector('.source-status').textContent = 'Kaynak bağlantısı kapandı. Pencereyi yeniden açabilirsin.'; if (this.canControl()) this.onPlayback({ time, playing: false }); this.update(); });
    this.extension.addEventListener('SOURCE_ERROR', event => { if (this.kind === 'page' && event.detail?.pageUrl === this.source?.url) { this.sourceError = event.detail.error; this.panel.querySelector('.source-status').textContent = event.detail.error; } });
    this.toggle.onclick = () => this.userToggle();
    controls.querySelector('.player-back').onclick = () => this.userSeek(this.currentTime - 10);
    controls.querySelector('.player-forward').onclick = () => this.userSeek(this.currentTime + 10);
    this.timeline.oninput = () => { this.scrubbing = true; controls.querySelector('.player-time').textContent = `${timeLabel(Number(this.timeline.value) / 1000 * this.duration)} / ${timeLabel(this.duration)}`; this.wake(); };
    this.timeline.onchange = () => { this.scrubbing = false; this.userSeek(Number(this.timeline.value) / 1000 * this.duration); };
    this.volume.oninput = () => this.setVolume(Number(this.volume.value), false);
    this.mute.onclick = () => this.setVolume(Number(this.volume.value), !this.isMuted);
    this.audio.onchange = () => this.selectAudio(this.audio.value);
    this.subtitle.onchange = () => this.selectSubtitle(this.subtitle.value);
    controls.querySelector('.player-fullscreen').onclick = () => this.fullscreen();
    this.stage.addEventListener('pointermove', () => { this.keyboard = false; this.wake(); });
    this.stage.addEventListener('pointerdown', () => { this.keyboard = false; this.wake(); });
    this.stage.addEventListener('focusin', () => this.wake());
    this.stage.addEventListener('keydown', event => this.keydown(event));
    video.addEventListener('click', () => this.userToggle());
    video.addEventListener('dblclick', () => this.fullscreen());
    for (const event of ['play', 'pause', 'seeked', 'ended']) video.addEventListener(event, () => {
      if (this.kind === 'page') return;
      this.update(); this.wake();
      if (Date.now() > this.suppressUntil && this.canControl() && this.isLeader()) this.onPlayback({ time: video.currentTime, playing: !video.paused && !video.ended }, true);
    });
    for (const event of ['timeupdate', 'durationchange', 'volumechange']) video.addEventListener(event, () => this.update());
    video.addEventListener('loadedmetadata', () => { this.updateTracks(); if (this.desired) this.apply(this.desired); });
    for (const tracks of [video.textTracks, video.audioTracks].filter(Boolean)) for (const event of ['addtrack', 'removetrack', 'change']) tracks.addEventListener(event, () => this.updateTracks());
    video.addEventListener('error', () => { if (this.kind !== 'page' && !this.hls && !this.dash && this.source) this.onError('Bu video tarayıcıda oynatılamadı. MKV kapsayıcısı veya ses/video codec’i desteklenmiyorsa kaynak sekmede izle.'); });
    document.addEventListener('fullscreenchange', () => { this.controls.querySelector('.player-fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Tam ekrandan çık' : 'Tam ekran'); this.wake(); });
    this.timer = setInterval(() => { if (this.kind !== 'page' && this.canControl() && this.isLeader() && this.playing) this.onPlayback({ time: this.currentTime, playing: true }, true); }, 4000);
    this.progressTimer = setInterval(() => { if (this.kind === 'page') this.update(); }, 250);
    this.update(); this.wake();
  }
  get currentTime() { return this.kind === 'page' ? Math.min(this.remote?.duration || 604800, (this.remote?.time || 0) + (this.remote?.playing && !this.remote?.buffering && !this.remote?.seeking ? Math.max(0, Math.min(3, (Date.now() - this.remote.receivedAt) / 1000)) : 0)) : this.video.currentTime || 0; }
  get duration() { return this.kind === 'page' ? this.remote?.duration || 0 : Number.isFinite(this.video.duration) ? this.video.duration : 0; }
  get playing() { return this.kind === 'page' ? Boolean(this.remote?.playing) : !this.video.paused && !this.video.ended; }
  get isMuted() { return this.kind === 'page' ? Boolean(this.remote?.muted) : this.video.muted; }
  wake() {
    this.stage.classList.remove('player-idle'); clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      const keyboardFocus = this.keyboard && this.controls.contains(document.activeElement);
      if (this.kind !== 'page' && this.playing && !this.scrubbing && !keyboardFocus) this.stage.classList.add('player-idle');
    }, 2500);
  }
  update() {
    const owner = this.canControl(), available = this.kind !== 'page' || Boolean(this.remote?.ready && Date.now() - this.remote.receivedAt < 5000);
    for (const element of [this.toggle, this.timeline, this.controls.querySelector('.player-back'), this.controls.querySelector('.player-forward')]) element.disabled = !owner || !available;
    if (!owner && this.kind !== 'page' && this.desired?.playing && this.video.paused) this.toggle.disabled = false;
    this.controls.querySelector('.player-fullscreen').setAttribute('aria-label', this.kind === 'page' ? 'Kaynak penceresini tam ekran yap' : document.fullscreenElement ? 'Tam ekrandan çık' : 'Tam ekran');
    this.toggle.textContent = this.playing ? 'Ⅱ' : '▶'; this.toggle.setAttribute('aria-label', this.playing ? 'Duraklat' : 'Oynat');
    this.mute.textContent = this.isMuted ? '◖×' : '◖))'; this.mute.setAttribute('aria-label', this.isMuted ? 'Sesi aç' : 'Sesi kapat');
    if (!this.scrubbing) { this.timeline.value = this.duration ? Math.min(1000, this.currentTime / this.duration * 1000) : 0; this.controls.querySelector('.player-time').textContent = `${timeLabel(this.currentTime)} / ${timeLabel(this.duration)}`; }
    if (this.kind === 'page') {
      this.panel.querySelector('.source-position').textContent = timeLabel(this.currentTime);
      this.panel.querySelector('.source-duration').textContent = `/ ${timeLabel(this.duration)}`;
      const target = this.desiredClock && playbackAt(this.desiredClock);
      this.panel.querySelector('.source-sync').textContent = !available ? 'Bağlantı bekleniyor' : this.remote.buffering ? 'Video yükleniyor…' : this.remote.seeking ? 'Konum değiştiriliyor…' : owner ? (this.isLeader() ? 'Kontrol sende' : 'Oynatma yetkin var') : target && Math.abs(target.time - this.currentTime) <= 1.5 && target.playing === this.playing ? 'Odayla senkronize' : 'Odaya eşitleniyor…';
    }
  }
  async load(source) {
    const generation = ++this.generation;
    this.suppressUntil = Date.now() + 1000;
    this.hls?.destroy(); this.hls = null; this.dash?.reset(); this.dash = null;
    if (this.kind === 'page') this.extension.request('CLOSE_SOURCE').catch(() => {});
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    this.source = source; this.kind = source.kind || resolveMediaSource(source.url).kind; this.remote = null; this.desiredClock = null; this.sourceError = null;
    this.panel.hidden = this.kind !== 'page'; this.video.hidden = this.kind === 'page';
    this.stage.classList.toggle('external-source', this.kind === 'page');
    this.panel.querySelector('.source-open').textContent = 'Kaynak penceresini aç';
    this.suppressUntil = Date.now() + 700;
    if (this.kind === 'page') {
      this.panel.querySelector('.source-status').textContent = 'Kaynak penceresini aç, ardından videoyu bir kez oynat.';
      this.extension.ping().then(result => { if (generation !== this.generation) return; if (result.version !== '0.5.2') this.panel.querySelector('.source-status').textContent = 'Pencere desteği için eklentiyi 0.5.2 sürümüne güncelle. Kurulum rehberinden yeni ZIP paketini indirebilirsin.'; else if (!result.ready) this.panel.querySelector('.source-status').textContent = 'Eklenti simgesinden video sayfalarına erişimi etkinleştir.'; }).catch(error => { if (generation === this.generation) this.panel.querySelector('.source-status').textContent = error.message; });
    } else if (this.kind === 'hls' && Hls.isSupported()) {
      const hls = this.hls = new Hls({ enableWorker: false });
      for (const event of [Hls.Events.MANIFEST_PARSED, Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED, Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH]) hls.on(event, () => this.updateTracks());
      hls.on(Hls.Events.ERROR, (event, data) => { if (data.fatal) this.onError('Yayın bağlantısı bu odada açılamadı. İzleme listesine .m3u8 yerine videonun bulunduğu web sayfasını ekle ve kaynak penceresini aç.'); });
      hls.loadSource(source.url); hls.attachMedia(this.video);
    } else if (this.kind === 'dash') {
      const { MediaPlayer } = await import('dashjs');
      if (generation !== this.generation) return;
      const dash = this.dash = MediaPlayer().create();
      dash.initialize(this.video, source.url, false);
      for (const event of ['streamInitialized', 'currentTrackChanged', 'textTracksAdded']) dash.on(event, () => this.updateTracks());
      dash.on('error', () => this.onError('DASH yayını yüklenemedi. Kaynak erişim izni ve tarayıcı codec desteğini kontrol et.'));
    } else this.video.src = source.url;
    this.updateTracks(); this.update(); this.wake();
  }
  async openSource() {
    const generation = this.generation;
    try {
      const extension = await this.extension.ping();
      if (generation !== this.generation) return;
      if (extension.version !== '0.5.2') throw new Error('Kaynak penceresi için eklentiyi 0.5.2 sürümüne güncelle ve oda sayfasını yenile.');
      const result = await this.extension.open(this.source.url);
      if (generation !== this.generation) return;
      this.panel.querySelector('.source-open').textContent = 'Kaynak penceresine git';
      this.panel.querySelector('.source-status').textContent = 'Kaynak pencerede videoyu bir kez başlat. Algılandığında bu odadan yönetebilirsin.';
      if (result.state) this.acceptRemote(result.state);
      if (this.desiredClock) await this.extension.sync(this.source.url, playbackAt(this.desiredClock), this.isLeader(), this.canControl());
    }
    catch (error) { this.panel.querySelector('.source-status').textContent = error.message; this.onError(error.message); }
  }
  acceptRemote(remote) {
    if (this.kind !== 'page' || remote.pageUrl !== this.source.url) return;
    const wasPlaying = this.playing;
    this.remote = { ...remote, receivedAt: remote.receivedAt || Date.now() };
    this.panel.querySelector('.source-open').textContent = 'Kaynak penceresine git';
    if (remote.playing || !this.desiredClock?.playing) this.sourceError = null;
    this.panel.querySelector('.source-status').textContent = this.sourceError || (remote.drm ? 'Korumalı oynatıcı algılandı. Her katılımcı kendi erişimiyle kaynak sayfada izlemeli; koruma kaldırılmaz.' : `Oynatıcı bağlı · ${remote.title}`);
    this.updateTracks(); this.update();
    const effectivePlaying = remote.playing;
    if (!remote.seeking && !remote.buffering && this.canControl() && (remote.userAction || this.isLeader() && (effectivePlaying !== wasPlaying || effectivePlaying && Date.now() - (this.lastRemoteBroadcast || 0) > 3000))) { this.lastRemoteBroadcast = Date.now(); this.onPlayback({ time: this.currentTime, playing: effectivePlaying }, !remote.userAction); }
    if (effectivePlaying !== wasPlaying) this.wake();
  }
  async apply(playback) {
    this.desired = playback;
    this.desiredClock = { time: playback.time, playing: playback.playing, receivedAt: Date.now() };
    if (!this.source) return;
    if (this.kind === 'page') {
      // The extension keeps the moving target and corrects the source in its own frame.
      // Receiving a source report must not rewind to an old room sample.
      this.extension.sync(this.source.url, playback, this.isLeader(), this.canControl()).catch(error => { if (this.remote) this.panel.querySelector('.source-status').textContent = error.message; });
      // The leader publishes source intent. Echoed room samples must never seek it.
      // Moderator actions change the controller, so the extension applies them as a follower.
      return;
    }
    this.suppressUntil = Date.now() + 500;
    try {
      if (this.video.readyState >= 1 && Math.abs(this.currentTime - playback.time) > 1.5) this.video.currentTime = playback.time;
      if (playback.playing && this.video.paused) await this.video.play();
      if (!playback.playing && !this.video.paused) this.video.pause();
    } catch { this.onNotice('Sesi açmak için oynat düğmesine bir kez bas.'); }
    this.update();
  }
  async userToggle() {
    if (!this.canControl()) {
      if (this.kind !== 'page' && this.desired?.playing) { try { await this.video.play(); } catch { this.onError('Videoyu başlatmak için oynat düğmesine tekrar bas.'); } }
      else this.onNotice('Oynatma yetkisi için oda sahibinden izin iste.');
      return;
    }
    const playback = { time: this.currentTime, playing: !this.playing };
    try {
      if (this.kind === 'page') await this.extension.command({ action: 'playback', ...playback });
      else if (playback.playing) await this.video.play(); else this.video.pause();
      this.onPlayback(playback); this.wake();
    } catch (error) { this.onError(error.message || 'Video başlatılamadı.'); }
  }
  async userSeek(time) {
    if (!this.canControl()) return;
    const playback = { time: Math.max(0, Math.min(this.duration || 604800, time)), playing: this.playing };
    try {
      if (this.kind === 'page') await this.extension.command({ action: 'playback', ...playback });
      else this.video.currentTime = playback.time;
      this.onPlayback(playback); this.wake();
    } catch (error) { this.onError(error.message); }
  }
  setVolume(volume, muted) {
    if (this.kind === 'page') this.extension.command({ action: 'volume', volume, muted }).catch(error => this.onError(error.message));
    else { this.video.volume = volume; this.video.muted = muted; }
    this.wake();
  }
  updateTracks() {
    let audio = [], subtitles = [], currentAudio = '', currentSubtitle = 'off';
    if (this.kind === 'page') {
      audio = this.remote?.audio || []; subtitles = this.remote?.subtitles || [];
      currentAudio = audio.find(t => t.active)?.id || ''; currentSubtitle = subtitles.find(t => t.active)?.id || 'off';
    } else if (this.hls) {
      audio = normalizeTracks(this.hls.audioTracks, 'Ses').map((t, i) => ({ ...t, id: String(i) }));
      subtitles = normalizeTracks(this.hls.subtitleTracks, 'Altyazı').map((t, i) => ({ ...t, id: String(i) }));
      currentAudio = String(this.hls.audioTrack); currentSubtitle = this.hls.subtitleDisplay && this.hls.subtitleTrack >= 0 ? String(this.hls.subtitleTrack) : 'off';
    } else if (this.dash) {
      try {
        const audioTracks = this.dash.getTracksFor('audio'), textTracks = this.dash.getTracksFor('text');
        audio = normalizeTracks(audioTracks, 'Ses').map((t, i) => ({ ...t, id: String(i) })); subtitles = normalizeTracks(textTracks, 'Altyazı').map((t, i) => ({ ...t, id: String(i) }));
        currentAudio = String(audioTracks.indexOf(this.dash.getCurrentTrackFor('audio')));
        currentSubtitle = this.dash.isTextEnabled() ? String(textTracks.indexOf(this.dash.getCurrentTrackFor('text'))) : 'off';
      } catch { /* Manifest not ready yet. */ }
    } else {
      audio = normalizeTracks(this.video.audioTracks, 'Ses').map((t, i) => ({ ...t, id: String(i) })); subtitles = normalizeTracks(this.video.textTracks, 'Altyazı').map((t, i) => ({ ...t, id: String(i) }));
      currentAudio = audio.find(t => t.active)?.id || ''; currentSubtitle = subtitles.find(t => t.active)?.id || 'off';
    }
    const tracksKey = JSON.stringify({ audio, subtitles, currentAudio, currentSubtitle });
    if (tracksKey === this.tracksKey) return; this.tracksKey = tracksKey;
    this.audio.replaceChildren(...(audio.length ? audio.map(t => option(t.id, t.label)) : [option('', this.kind === 'page' ? 'Kaynak menüsünü kullan' : 'Kaynakta tek ses')]));
    this.subtitle.replaceChildren(option('off', subtitles.length ? 'Kapalı' : this.kind === 'page' ? 'Kaynak menüsünü kullan' : 'Altyazı yok'), ...subtitles.map(t => option(t.id, t.label)));
    this.audio.value = currentAudio; this.subtitle.value = currentSubtitle;
    this.audio.disabled = audio.length < 2; this.subtitle.disabled = !subtitles.length;
  }
  selectAudio(id) {
    if (this.kind === 'page') this.extension.command({ action: 'audio', id }).catch(error => this.onError(error.message));
    else if (this.hls) this.hls.audioTrack = Number(id);
    else if (this.dash) this.dash.setCurrentTrack(this.dash.getTracksFor('audio')[Number(id)]);
    else Array.from(this.video.audioTracks || []).forEach((track, index) => track.enabled = index === Number(id));
    this.wake();
  }
  selectSubtitle(id) {
    if (this.kind === 'page') this.extension.command({ action: 'subtitle', id }).catch(error => this.onError(error.message));
    else if (this.hls) { this.hls.subtitleTrack = id === 'off' ? -1 : Number(id); this.hls.subtitleDisplay = id !== 'off'; }
    else if (this.dash) { this.dash.enableText(id !== 'off'); if (id !== 'off') this.dash.setCurrentTrack(this.dash.getTracksFor('text')[Number(id)]); }
    else Array.from(this.video.textTracks || []).forEach((track, index) => track.mode = id !== 'off' && index === Number(id) ? 'showing' : 'disabled');
    this.wake();
  }
  async fullscreen() {
    if (this.kind === 'page') { try { await this.extension.fullscreen(); } catch (error) { this.onError(error.message); } return; }
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (this.stage.requestFullscreen) await this.stage.requestFullscreen(); else this.onNotice('Bu tarayıcı bu görünümde tam ekranı desteklemiyor.'); }
    catch { this.onError('Tam ekran açılamadı. Oynatıcının tam ekran düğmesini tekrar dene.'); }
    this.wake();
  }
  keydown(event) {
    if (event.key === 'Tab') { this.keyboard = true; this.wake(); return; }
    if (['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
    if ([' ', 'k', 'K'].includes(event.key)) { event.preventDefault(); this.userToggle(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); this.userSeek(this.currentTime - 10); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); this.userSeek(this.currentTime + 10); }
    else if (['f', 'F'].includes(event.key)) this.fullscreen();
    else if (['m', 'M'].includes(event.key)) this.setVolume(Number(this.volume.value), !this.isMuted);
  }
}
