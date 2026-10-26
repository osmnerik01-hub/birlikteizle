import { PERMISSIONS, permissionsFor } from '/room-policy.js?v=a7defc4872102c29';
const $ = selector => document.querySelector(selector);
let backend, selected, detail, cursor, rooms = [], toastTimer;
function toast(message, error = false) { const el = $('#admin-toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 6000); }
const date = value => new Intl.DateTimeFormat('tr', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
async function run(button, operation) { if (button) button.disabled = true; try { await operation(); } catch (error) { toast(error.message || 'İşlem tamamlanamadı.', true); } finally { if (button?.isConnected) button.disabled = false; } }
function confirmAction(title, text) { const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-text').textContent = text; dialog.returnValue = ''; return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); }); }
function identity(value) {
  $('#dashboard').hidden = !value.admin; $('#login-card').hidden = value.admin; $('#logout').hidden = !value.signedIn;
  $('#login-status').textContent = value.admin ? '' : value.signedIn ? `${value.email || 'Bu hesap'} yönetici olarak yetkilendirilmemiş. Doğru hesapla giriş yap.` : 'Yetkili Google hesabınla giriş yap.';
  $('#admin-email').textContent = value.email || '';
  if (value.admin) run(null, () => loadRooms(true));
  else { rooms = []; selected = null; detail = null; $('#detail-content').hidden = true; $('#detail-empty').hidden = false; }
}
async function loadRooms(reset = false) {
  const result = await backend.listRooms(reset ? null : cursor);
  rooms = reset ? result.rooms : [...rooms, ...result.rooms.filter(room => !rooms.some(old => old.id === room.id))];
  cursor = result.cursor; $('#load-more').hidden = !cursor; renderRooms();
}
function renderRooms() {
  const search = $('#room-search').value.trim().toLocaleLowerCase('tr');
  const visible = rooms.filter(room => `${room.title} ${room.id}`.toLocaleLowerCase('tr').includes(search));
  $('#room-total').textContent = rooms.length; $('#list-empty').hidden = visible.length > 0;
  $('#list-empty').textContent = search ? 'Yüklenen odalarda eşleşme bulunamadı.' : 'Henüz bir oda yok.';
  $('#room-list').replaceChildren(...visible.map(room => {
    const button = document.createElement('button'); button.className = `admin-room${selected === room.id ? ' selected' : ''}`;
    const title = document.createElement('strong'); title.textContent = room.title;
    const code = document.createElement('small'); code.textContent = `${room.id.slice(0,8)} · Son kullanım ${date(room.lastActiveAt)}`;
    button.append(title, code); button.onclick = () => run(button, () => selectRoom(room.id)); return button;
  }));
}
async function selectRoom(id) { const result = await backend.room(id); selected = id; detail = result; renderRooms(); renderDetail(); }
function renderDetail() {
  if (!detail || !selected) return;
  const { room, raw } = detail;
  $('#detail-empty').hidden = true; $('#detail-content').hidden = false;
  $('#detail-title').textContent = room.title; $('#detail-code').textContent = room.id;
  $('#room-status').textContent = room.closed ? 'Kapalı' : `${room.members.length} çevrimiçi`;
  $('#visit-room').href = `/room/${room.id}`; $('#room-name').value = room.title;
  $('#toggle-room').textContent = room.closed ? 'Odayı yeniden aç' : 'Odayı kapat'; $('#pause-room').disabled = room.closed;
  $('#detail-count').textContent = `(${Object.keys(raw.members || {}).length})`;
  $('#admin-members').replaceChildren(...Object.values(raw.members || {}).map(person => {
    const row = document.createElement('div'); row.className = 'admin-member';
    const top = document.createElement('div'); top.className = 'admin-member-top';
    const name = document.createElement('strong'); name.textContent = person.name;
    const role = document.createElement('small'); role.textContent = person.id === room.host ? 'Oda sahibi' : room.members.some(p => p.id === person.id) ? 'Çevrimiçi' : 'Çevrimdışı';
    top.append(name, role);
    if (person.id !== room.host) { const host = document.createElement('button'); host.className = 'button secondary'; host.textContent = 'Oda sahibi yap'; host.onclick = () => run(host, async () => { if (await confirmAction('Oda sahibini değiştir', `${person.name} bu odanın tüm yetkilerini alacak.`)) await perform('host', { memberId: person.id }); }); top.append(host); }
    row.append(top);
    const permissions = permissionsFor(room, person.id), options = document.createElement('div'); options.className = 'permission-options';
    for (const [key, text] of Object.entries(PERMISSIONS)) {
      const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = permissions[key]; input.disabled = person.id === room.host;
      input.onchange = () => run(input, async () => { await perform('permissions', { memberId: person.id, permissions: { ...permissions, [key]: input.checked } }); });
      label.append(input, document.createTextNode(text)); options.append(label);
    }
    row.append(options); return row;
  }));
  $('#admin-queue').replaceChildren(...room.queue.map(item => {
    const el = document.createElement('div'); el.className = 'admin-queue-item';
    el.textContent = `${item.id === room.playback.videoId ? '▶ ' : ''}${item.title}`;
    const url = document.createElement('small'); url.textContent = item.url; el.append(url); return el;
  }));
}
async function perform(action, input) {
  const id = selected; await backend.action(id, action, input);
  if (action === 'delete') { rooms = rooms.filter(r => r.id !== id); selected = null; detail = null; $('#detail-content').hidden = true; $('#detail-empty').hidden = false; renderRooms(); }
  else if (id === selected) { await selectRoom(id); if (action === 'rename') { const room = rooms.find(r => r.id === id); if (room) room.title = detail.room.title; renderRooms(); } }
  toast('Değişiklik kaydedildi.');
}
$('#room-search').oninput = renderRooms;
$('#refresh').onclick = event => run(event.currentTarget, async () => { await loadRooms(true); if (selected) await selectRoom(selected); });
$('#load-more').onclick = event => run(event.currentTarget, () => loadRooms());
$('#rename-form').onsubmit = event => { event.preventDefault(); run(event.submitter, () => perform('rename', { title: $('#room-name').value })); };
$('#pause-room').onclick = event => run(event.currentTarget, () => perform('pause'));
$('#toggle-room').onclick = event => run(event.currentTarget, () => perform('closed', { closed: !detail.room.closed }));
$('#clear-chat').onclick = event => run(event.currentTarget, async () => { if (await confirmAction('Sohbet temizlensin mi?', 'Bu odanın mesajları kalıcı olarak silinecek.')) await perform('clear-chat'); });
$('#delete-room').onclick = event => run(event.currentTarget, async () => { if (await confirmAction('Oda kalıcı silinsin mi?', 'Katılımcılar, mesajlar ve izleme listesi silinecek. Bu işlem geri alınamaz.')) await perform('delete'); });
$('#cleanup').onclick = event => run(event.currentTarget, async () => { const result = await backend.cleanup(); toast(`${result.removed} süresi dolan boş oda temizlendi.`); await loadRooms(true); });
$('#google-login').onclick = event => run(event.currentTarget, async () => { try { identity(await backend.login()); } catch (error) { if (error.code === 'auth/operation-not-allowed') throw new Error('Firebase Authentication ayarlarında Google girişini etkinleştir.'); if (error.code === 'auth/unauthorized-domain') throw new Error('Bu siteyi Firebase Authentication yetkili alan adlarına ekle.'); throw error; } });
$('#logout').onclick = event => run(event.currentTarget, async () => { await backend.logout(); identity({ signedIn: false, admin: false }); });

async function start() {
  const config = await (await fetch('/app-config.json', { cache: 'no-store' })).json();
  if (config.backend === 'firebase') { const { createAdminBackend } = await import('/admin-client.js?v=a7defc4872102c29'); backend = createAdminBackend(); backend.watchIdentity(identity); }
  else {
    $('#google-login').hidden = true; $('#node-login').hidden = false; $('#login-status').textContent = 'Sunucunun ADMIN_TOKEN anahtarıyla giriş yap.';
    $('#login-description').textContent = 'Bu sunucunun yönetici anahtarıyla odaları yönetebilirsin. İzleme odasındaki misafir kimliğin korunur.';
    let adminToken = '';
    const api = async (path, data) => { const res = await fetch(`/api/admin${path}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) }); const value = await res.json(); if (!res.ok) throw new Error(value.error); return value; };
    backend = { listRooms: cursor => api('/rooms' + (cursor ? `?beforeAt=${cursor.at}&beforeId=${cursor.id}` : '')), room: id => api(`/rooms/${id}`), action: (id, action, input) => api(`/rooms/${id}`, { action, ...input }), cleanup: () => api('/cleanup', {}), logout: async () => { adminToken = ''; } };
    $('#node-login').onsubmit = event => { event.preventDefault(); run(event.submitter, async () => { adminToken = $('#admin-token').value; await api('/rooms'); $('#admin-token').value = ''; identity({ signedIn: true, admin: true, email: 'Sunucu yöneticisi' }); }); };
  }
}
start().catch(error => { $('#login-status').textContent = 'Yönetim servisine bağlanılamadı.'; toast(error.message, true); });
