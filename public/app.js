import { createMessageQueue } from '/message-queue.js';
import { WatchPlayer } from '/player.js';
import { resolveMediaSource } from '/media-source.js';
import { permissionsFor, PERMISSIONS, controllerOf } from '/room-policy.js';
const $ = selector => document.querySelector(selector);
const video = $('#video');
let roomId = location.pathname.match(/^\/room\/([a-f0-9-]{8}|[a-f0-9-]{36})$/)?.[1];
let token, memberId, state, events, lastVideo, covered = true;
let toastTimer, lastMessageIds = '', lastQueue = '', lastMembers = '';
let name = localStorage.getItem('bi-name') || '';
const player = new WatchPlayer(video, {
  canControl: () => can('playback'),
  isLeader: () => isLeader(),
  onPlayback: (playback, heartbeat = false) => { if (!state || !can('playback')) return; api('playback', { ...playback, videoId: state.playback.videoId, heartbeat }).catch(error => toast(error.message, true)); },
  onError: message => toast(message, true), onNotice: message => toast(message)
});
let firebaseBackend;
const backendReady = fetch('/app-config.json').then(response => response.ok ? response.json() : { backend: 'node' }).then(async config => {
  if (config.backend !== 'firebase') return;
  const { createFirebaseBackend } = await import('/firebase-client.js');
  firebaseBackend = await createFirebaseBackend();
  const sweep = () => firebaseBackend.cleanupExpired().catch(() => {});
  sweep(); setInterval(sweep, 10 * 60 * 1000);
  $('.file-drop').hidden = true; $('.or-divider').hidden = true;
  $('#upload-strip strong').textContent = 'Bir video bağlantısı paylaş';
  $('#upload-strip small').textContent = 'Bir web sayfası veya video bağlantısı ekle.';
});
// The startup flow reports this error after the name dialog is submitted.
backendReady.catch(() => {});
const icons = id => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
function toast(message, error = false) { $('#toast').textContent = message; $('#toast').classList.toggle('error', error); $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 8000 : 3500); }
async function api(action, data = {}) { await backendReady; if (firebaseBackend) return firebaseBackend.request(action, roomId, data); const res = await fetch(`/api/rooms${action === 'create' ? '' : `/${roomId}/${action}`}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Bağlantı kurulamadı.'); return result; }
function isHost() { return Boolean(memberId && state?.host === memberId); }
function can(key) { return !state?.closed && permissionsFor(state, memberId)[key]; }
function isLeader() { return can('playback') && controllerOf(state) === memberId; }
function avatar(person) { const el = document.createElement('span'); el.className = 'avatar'; el.textContent = person.name.slice(0, 1).toLocaleUpperCase('tr'); el.title = person.name; return el; }
function updateProfile() { $('#profile-name').textContent = name; $('#profile-avatar').textContent = name.slice(0, 1).toLocaleUpperCase('tr'); }
async function join() {
  if (!roomId) { const result = await api('create'); roomId = result.id; history.replaceState({}, '', `/room/${roomId}`); }
  const sessionKey = `bi-session-${roomId}`;
  const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
  const result = await api('join', { name, token: saved?.token }); token = result.token; memberId = result.memberId;
  sessionStorage.setItem(sessionKey, JSON.stringify({ token, memberId, name })); render(result.room);
  updateProfile(); connect();
}
function connect() {
  if (firebaseBackend) {
    events?.close();
    events = firebaseBackend.subscribe(roomId, render,
      connected => { $('#sync-status').textContent = connected ? 'Herkes aynı anda' : 'Yeniden bağlanılıyor…'; },
      error => { if (error.message.includes('bulunamadı')) closeRoom(error.message); else { $('#sync-status').textContent = 'Odaya bağlanılamadı'; toast(error.message, true); } });
    return;
  }
  events?.close(); events = new EventSource(`/api/rooms/${roomId}/events`);
  events.onmessage = event => { $('#sync-status').textContent = 'Herkes aynı anda'; render(JSON.parse(event.data)); };
  events.onerror = async () => {
    $('#sync-status').textContent = 'Yeniden bağlanılıyor…';
    try { const response = await fetch(`/api/rooms/${roomId}/status`); if (response.status === 404 || response.status === 410) { closeRoom('Oda silinmiş veya kapatılmış. Yeni bir oda oluşturabilirsin.'); } else if (response.status === 401) { events.close(); await join(); } }
    catch { /* EventSource reconnects automatically. */ }
  };
}
function render(next) {
  state = next;
  if (next.closed) { closeRoom('Bu oda yönetici tarafından kapatıldı.'); return; }
  $('#room-title').textContent = next.title; $('#room-code').textContent = `ODA · ${next.id.slice(0, 8).toUpperCase()}`;
  const count = next.members.length; $('#member-count').textContent = `${count} kişi birlikte`; $('#online-count').textContent = `${count} çevrimiçi`; $('#tab-count').textContent = count;
  $('#control-label').textContent = can('playback') ? (isLeader() ? 'Kontrol sende' : 'Oynatma yetkin var') : 'İzleyici';
  for (const id of ['#add-video', '#upload-strip']) $(id).disabled = !(can('addVideo') || can('manageQueue'));
  player.update();
  const membersKey = JSON.stringify([next.members, next.permissions, next.host, isHost()]);
  if (membersKey !== lastMembers) { lastMembers = membersKey; renderMembers(next); }
  const queueKey = JSON.stringify(next.queue) + next.playback.videoId + can('manageQueue');
  if (queueKey !== lastQueue) { lastQueue = queueKey; renderQueue(next); }
  const messageKey = next.messages.map(m => m.id).join(',');
  if (messageKey !== lastMessageIds) { lastMessageIds = messageKey; const content = $('#chat-content'); const nearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 120; $('#messages').replaceChildren(...next.messages.map(message => { const row = document.createElement('div'); row.className = `message-row${message.memberId === memberId ? ' own' : ''}`; row.append(avatar(message)); const body = document.createElement('div'); body.className = 'message-body'; const meta = document.createElement('div'); meta.className = 'message-meta'; const author = document.createElement('strong'); author.textContent = message.name + (message.memberId === memberId ? ' · sen' : ''); const time = document.createElement('time'); time.dateTime = new Date(message.at).toISOString(); time.textContent = new Intl.DateTimeFormat('tr', { hour: '2-digit', minute: '2-digit' }).format(message.at); meta.append(author, time); const text = document.createElement('p'); text.className = 'message-text'; text.textContent = message.text; body.append(meta, text); row.append(body); return row; })); if (nearBottom) content.scrollTop = content.scrollHeight; }
  const selected = next.queue.find(item => item.id === next.playback.videoId);
  if (selected && selected.id !== lastVideo) {
    lastVideo = selected.id; $('#video-title').textContent = selected.title;
    const kind = selected.kind || resolveMediaSource(selected.url).kind;
    covered = kind !== 'page' && !next.playback.playing && next.playback.time < 1; $('#video-cover').hidden = !covered;
    player.load({ ...selected, kind }).then(() => player.apply(next.playback)).catch(error => toast(error.message, true));
  } else if (!isLeader() || Math.abs(player.currentTime - next.playback.time) > 3 || player.playing !== next.playback.playing) player.apply(next.playback);
  if (next.playback.playing && covered) { covered = false; $('#video-cover').hidden = true; }
}
video.addEventListener('play', () => { covered = false; $('#video-cover').hidden = true; });
$('#start-video').onclick = async () => { if (state) { covered = false; $('#video-cover').hidden = true; await player.userToggle(); } };
const sendMessage = createMessageQueue(async text => { if (!state || state.closed) throw new Error('Mesaj göndermek için açık bir odaya katılmalısın.'); await api('message', { text }); });
$('#chat-form').onsubmit = async event => {
  event.preventDefault();
  const input = $('#message'), text = input.value.trim();
  if (!text) return;
  // Clear immediately, so a pending write cannot duplicate or erase the next draft.
  input.value = '';
  try { await sendMessage(text); $('#chat-content').scrollTop = $('#chat-content').scrollHeight; }
  catch (error) { input.value = input.value ? `${text}\n${input.value}` : text; toast(error.message, true); }
};
document.querySelectorAll('[data-reaction]').forEach(button => button.onclick = () => sendMessage(button.dataset.reaction).catch(error => toast(error.message, true)));
function showTab(members) { $('#chat-content').hidden = members; $('#members-list').hidden = !members; $('#messages-tab').classList.toggle('selected', !members); $('#members-tab').classList.toggle('selected', members); }
$('#messages-tab').onclick = () => showTab(false); $('#members-tab').onclick = () => showTab(true);
async function invite() { try { await navigator.clipboard.writeText(location.href); toast('Oda bağlantısı kopyalandı. Arkadaşlarınla paylaş!'); } catch { const dialog = document.createElement('dialog'); const label = document.createElement('label'); label.textContent = 'Bu bağlantıyı arkadaşlarınla paylaş'; const input = document.createElement('input'); input.value = location.href; input.readOnly = true; label.append(input); const close = document.createElement('button'); close.className = 'button primary full'; close.textContent = 'Tamam'; close.onclick = () => { dialog.close(); dialog.remove(); }; dialog.append(label, close); document.body.append(dialog); dialog.showModal(); input.select(); } }
for (const id of ['#invite', '#side-invite']) $(id).onclick = invite;
$('#watch-nav').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
for (const id of ['#new-room', '#mobile-new-room']) $(id).onclick = async () => { try { const result = await api('create'); location.assign(`/room/${result.id}`); } catch (error) { toast(error.message, true); } };
for (const id of ['#add-video', '#upload-strip']) $(id).onclick = () => { if (!(can('addVideo') || can('manageQueue'))) return toast('Video eklemek için oda sahibinden izin iste.'); $('#video-dialog').showModal(); };
$('.close-dialog').onclick = () => $('#video-dialog').close();
$('#video-form').onsubmit = async event => { event.preventDefault(); const url = $('#new-url').value.trim(); if (!url) { $('#new-url').focus(); return toast('Bir video veya web sayfası bağlantısı gir.', true); } try { const resolved = resolveMediaSource(url); await api('video', { ...resolved, title: $('#new-title').value.trim() || decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname).slice(0, 120) }); $('#video-form').reset(); $('#video-dialog').close(); toast(resolved.kind === 'page' ? 'Web sayfası eklendi. Listeden seçip kaynak penceresini açabilirsin.' : 'Video izleme listesine eklendi.'); } catch (error) { toast(error.message, true); } };
$('#file-input').onchange = () => {
  if (firebaseBackend) return toast('Bu sürümde doğrudan video bağlantısı ekleyebilirsin.');
  const file = $('#file-input').files[0]; if (!file) return;
  if (file.size > 500 * 1024 * 1024) return toast('Dosya en fazla 500 MB olabilir.', true);
  const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/rooms/${roomId}/upload?name=${encodeURIComponent(file.name)}`); xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  $('#upload-progress').hidden = false; $('#file-input').disabled = true;
  xhr.upload.onprogress = event => { if (event.lengthComputable) { const percentage = Math.round(event.loaded / event.total * 100); $('#upload-progress progress').value = percentage; $('#upload-progress span').textContent = `%${percentage} yüklendi${percentage === 100 ? ' · İşleniyor…' : ''}`; } };
  const finish = () => { $('#file-input').disabled = false; $('#file-input').value = ''; $('#upload-progress').hidden = true; };
  xhr.onload = () => { finish(); let result; try { result = JSON.parse(xhr.responseText); } catch { result = {}; } if (xhr.status >= 200 && xhr.status < 300) { $('#video-dialog').close(); toast('Videon yüklendi, izleme listesinden seçebilirsin.'); } else toast(result.error || 'Video yüklenemedi.', true); };
  xhr.onerror = () => { finish(); toast('Yükleme sırasında bağlantı kesildi. Yeniden dene.', true); }; xhr.send(file);
};
$('#edit-name').onclick = () => { $('#name-input').value = name; $('#name-dialog').showModal(); };
$('#name-dialog').addEventListener('cancel', event => { if (!name) event.preventDefault(); });
$('#name-form').onsubmit = async event => { event.preventDefault(); name = $('#name-input').value.trim(); if (!name) return; localStorage.setItem('bi-name', name); $('#name-dialog').close(); try { await join(); } catch (error) { toast(error.message, true); } };
if (!name) $('#name-dialog').showModal(); else join().catch(error => { toast(error.message, true); $('#sync-status').textContent = 'Odaya bağlanılamadı'; });

function closeRoom(message) {
  if (state) state.closed = true;
  events?.close(); video.pause(); player.extension.request('CLOSE_SOURCE').catch(() => {});
  player.update(); $('#sync-status').textContent = 'Oda kapalı';
  for (const id of ['#add-video','#upload-strip','#message','#chat-form button','#start-video']) $(id).disabled = true;
  toast(message, true);
}
function renderMembers(next) {
  $('#member-avatars').replaceChildren(...next.members.slice(0, 4).map(avatar));
  $('#members-list').replaceChildren(...next.members.map(person => {
    const group = document.createElement('div'); group.className = 'member-group';
    const row = document.createElement('div'); row.className = 'member-entry'; row.append(avatar(person));
    const label = document.createElement('span'); label.textContent = person.name + (person.id === memberId ? ' (sen)' : ''); row.append(label);
    const grants = permissionsFor(next, person.id), role = document.createElement('small');
    role.textContent = person.id === next.host ? 'Oda sahibi' : grants.playback || grants.addVideo || grants.manageQueue ? 'Yetkili izleyici' : 'İzleyici'; row.append(role); group.append(row);
    if (isHost() && person.id !== next.host) {
      const options = document.createElement('div'); options.className = 'member-permissions';
      for (const [key, text] of Object.entries(PERMISSIONS)) {
        const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = grants[key];
        input.onchange = async () => {
          for (const checkbox of options.querySelectorAll('input')) checkbox.disabled = true;
          try { await api('permissions', { memberId: person.id, permissions: { ...grants, [key]: input.checked } }); }
          catch (error) { input.checked = grants[key]; toast(error.message, true); }
          finally { for (const checkbox of options.querySelectorAll('input')) checkbox.disabled = false; }
        };
        label.append(input, document.createTextNode(text)); options.append(label);
      }
      group.append(options);
    }
    return group;
  }));
}
function renderQueue(next) {
  $('#queue-count').textContent = next.queue.length;
  $('#queue').replaceChildren(...next.queue.map((item, index) => {
    const row = document.createElement('div'); row.className = 'queue-row';
    const button = document.createElement('button'), current = item.id === next.playback.videoId;
    button.className = 'queue-item' + (current ? ' current' : ''); button.disabled = !can('manageQueue');
    button.innerHTML = '<span class="queue-thumb">' + icons('play') + '</span><span class="queue-info"><strong></strong><small></small></span><span class="queue-state"></span>';
    button.querySelector('strong').textContent = item.title; button.querySelector('small').textContent = item.source;
    button.querySelector('.queue-state').textContent = current ? 'Şimdi oynatılıyor' : 'Sırada · ' + (index + 1);
    button.onclick = () => api('select', { videoId: item.id }).catch(error => toast(error.message, true)); row.append(button);
    if (can('manageQueue') && next.queue.length > 1) {
      const remove = document.createElement('button'); remove.className = 'queue-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', item.title + ' videosunu listeden kaldır');
      remove.onclick = () => { remove.disabled = true; api('remove-video', { videoId: item.id }).catch(error => { remove.disabled = false; toast(error.message, true); }); }; row.append(remove);
    }
    return row;
  }));
}
